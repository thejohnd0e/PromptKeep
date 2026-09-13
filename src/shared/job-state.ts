import type { AssociationAttemptId, EnrichmentJobId, UnixMilliseconds } from "./contracts"
import { LIMITS } from "./contracts"
import {
  type ActiveJobState,
  type AwaitingAssociationMachine,
  activeJobValues,
  type PendingJobState,
  parseStoredJobEnvelope,
  type ReadyAssociationMachine,
  type ReadyJobState,
  type RunningJobState,
  type StoredJobEnvelope,
} from "./job-state-schema"

export type {
  ActiveJobState,
  AwaitingAssociationMachine,
  PendingJobState,
  ReadyAssociationMachine,
  ReadyJobState,
  RunningJobState,
  StoredJobEnvelope,
} from "./job-state-schema"

export const JOB_STORAGE_KEY = "associationJobsV1" as const
export const JOB_STATE_LIMITS = {
  maxJobs: 32,
  maxSerializedBytes: 512 * 1024,
} as const

export type SessionStorageSnapshot = { readonly [JOB_STORAGE_KEY]?: string }
export type SessionStorageWrite = { readonly [JOB_STORAGE_KEY]: string }

export interface SessionStorageArea {
  get(key: typeof JOB_STORAGE_KEY): Promise<SessionStorageSnapshot>
  set(items: SessionStorageWrite): Promise<void>
  remove(key: typeof JOB_STORAGE_KEY): Promise<void>
}

export type TerminalJobState = {
  readonly state: "succeeded" | "failed" | "cancelled"
  readonly jobId: EnrichmentJobId
  readonly attemptId: AssociationAttemptId
  readonly completedAt: UnixMilliseconds
}

export type JobStoreFailure =
  | { readonly code: "STORAGE_READ_REJECTED"; readonly cause: string }
  | { readonly code: "STORAGE_WRITE_REJECTED"; readonly cause: string }
  | { readonly code: "STORAGE_MALFORMED" }
  | { readonly code: "JOB_LIMIT_EXCEEDED"; readonly limit: number }
  | {
      readonly code: "STORAGE_BYTES_EXCEEDED"
      readonly actualBytes: number
      readonly limitBytes: number
    }
  | { readonly code: "PROMPT_TOO_LARGE"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "JOB_EXPIRED"; readonly expiredAt: UnixMilliseconds }
  | { readonly code: "JOB_DUPLICATE" }
  | { readonly code: "JOB_NOT_FOUND" }

export type JobStoreResult<Value> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "rejected"; readonly error: JobStoreFailure }

type Clock = () => UnixMilliseconds

function rejected<Value>(error: JobStoreFailure): JobStoreResult<Value> {
  return { kind: "rejected", error }
}

function matchesJob(
  job: ActiveJobState,
  jobId: EnrichmentJobId,
  attemptId: AssociationAttemptId,
): boolean {
  const values = activeJobValues(job)
  return values.jobId === jobId && values.attemptId === attemptId
}

export class SessionJobStore {
  readonly #storage: SessionStorageArea
  readonly #clock: Clock

  constructor(storage: SessionStorageArea, clock: Clock) {
    this.#storage = storage
    this.#clock = clock
  }

  async open(machine: AwaitingAssociationMachine): Promise<JobStoreResult<PendingJobState>> {
    const loaded = await this.#load()
    if (loaded.kind === "rejected") return loaded
    if (this.#clock() >= machine.attempt.expiresAt) {
      return rejected({ code: "JOB_EXPIRED", expiredAt: machine.attempt.expiresAt })
    }
    if (
      loaded.value.some((job) => {
        const values = activeJobValues(job)
        return values.jobId === machine.attempt.jobId || values.attemptId === machine.attempt.id
      })
    ) {
      return rejected({ code: "JOB_DUPLICATE" })
    }
    const pending = { state: "pending", machine } as const satisfies PendingJobState
    const stored = await this.#write([...loaded.value, pending])
    return stored.kind === "rejected" ? stored : { kind: "ok", value: pending }
  }

  async saveReady(machine: ReadyAssociationMachine): Promise<JobStoreResult<ReadyJobState>> {
    const loaded = await this.#load()
    if (loaded.kind === "rejected") return loaded
    if (this.#clock() >= machine.binding.expiresAt) {
      return rejected({ code: "JOB_EXPIRED", expiredAt: machine.binding.expiresAt })
    }
    if (
      !loaded.value.some((job) => matchesJob(job, machine.binding.jobId, machine.binding.attemptId))
    ) {
      return rejected({ code: "JOB_NOT_FOUND" })
    }
    const ready = { state: "ready", machine } as const satisfies ReadyJobState
    const jobs = loaded.value.map((job) =>
      matchesJob(job, machine.binding.jobId, machine.binding.attemptId) ? ready : job,
    )
    const stored = await this.#write(jobs)
    return stored.kind === "rejected" ? stored : { kind: "ok", value: ready }
  }

  async start(
    machine: ReadyAssociationMachine,
    startedAt: UnixMilliseconds,
  ): Promise<JobStoreResult<RunningJobState>> {
    const loaded = await this.#load()
    if (loaded.kind === "rejected") return loaded
    if (this.#clock() >= machine.binding.expiresAt) {
      return rejected({ code: "JOB_EXPIRED", expiredAt: machine.binding.expiresAt })
    }
    if (
      !loaded.value.some((job) => matchesJob(job, machine.binding.jobId, machine.binding.attemptId))
    ) {
      return rejected({ code: "JOB_NOT_FOUND" })
    }
    const running = { state: "running", machine, startedAt } as const satisfies RunningJobState
    const jobs = loaded.value.map((job) =>
      matchesJob(job, machine.binding.jobId, machine.binding.attemptId) ? running : job,
    )
    const stored = await this.#write(jobs)
    return stored.kind === "rejected" ? stored : { kind: "ok", value: running }
  }

  async finish(terminal: TerminalJobState): Promise<JobStoreResult<TerminalJobState>> {
    const loaded = await this.#load()
    if (loaded.kind === "rejected") return loaded
    const jobs = loaded.value.filter((job) => {
      const values = activeJobValues(job)
      return values.jobId !== terminal.jobId || values.attemptId !== terminal.attemptId
    })
    if (jobs.length === loaded.value.length) return rejected({ code: "JOB_NOT_FOUND" })
    const stored = await this.#write(jobs)
    return stored.kind === "rejected" ? stored : { kind: "ok", value: terminal }
  }

  async restore(): Promise<JobStoreResult<readonly ActiveJobState[]>> {
    return this.#load()
  }

  async #load(): Promise<JobStoreResult<readonly ActiveJobState[]>> {
    let snapshot: SessionStorageSnapshot
    try {
      snapshot = await this.#storage.get(JOB_STORAGE_KEY)
    } catch (error) {
      const cause = error instanceof Error ? error.name : "UnknownStorageRejection"
      return rejected({ code: "STORAGE_READ_REJECTED", cause })
    }
    const serialized = snapshot[JOB_STORAGE_KEY]
    if (serialized === undefined) return { kind: "ok", value: [] }
    const actualBytes = new TextEncoder().encode(serialized).byteLength
    if (actualBytes > JOB_STATE_LIMITS.maxSerializedBytes) {
      const cleared = await this.#clear()
      return cleared.kind === "rejected"
        ? cleared
        : rejected({
            code: "STORAGE_BYTES_EXCEEDED",
            actualBytes,
            limitBytes: JOB_STATE_LIMITS.maxSerializedBytes,
          })
    }
    const envelope = parseStoredJobEnvelope(serialized)
    if (envelope === undefined) {
      const cleared = await this.#clear()
      return cleared.kind === "rejected" ? cleared : rejected({ code: "STORAGE_MALFORMED" })
    }
    if (envelope.jobs.length > JOB_STATE_LIMITS.maxJobs) {
      const cleared = await this.#clear()
      return cleared.kind === "rejected"
        ? cleared
        : rejected({ code: "JOB_LIMIT_EXCEEDED", limit: JOB_STATE_LIMITS.maxJobs })
    }
    const active = envelope.jobs.filter((job) => activeJobValues(job).expiresAt > this.#clock())
    if (active.length !== envelope.jobs.length) {
      const pruned = await this.#write(active)
      if (pruned.kind === "rejected") return pruned
    }
    return { kind: "ok", value: active }
  }

  async #write(
    jobs: readonly ActiveJobState[],
  ): Promise<JobStoreResult<readonly ActiveJobState[]>> {
    if (jobs.length > JOB_STATE_LIMITS.maxJobs) {
      return rejected({ code: "JOB_LIMIT_EXCEEDED", limit: JOB_STATE_LIMITS.maxJobs })
    }
    for (const job of jobs) {
      const actualBytes = new TextEncoder().encode(activeJobValues(job).rawPrompt).byteLength
      if (actualBytes > LIMITS.maxPromptUtf8Bytes) {
        return rejected({
          code: "PROMPT_TOO_LARGE",
          actualBytes,
          limitBytes: LIMITS.maxPromptUtf8Bytes,
        })
      }
    }
    if (jobs.length === 0) return this.#clear()
    const envelope: StoredJobEnvelope = { version: 1, jobs }
    const serialized = JSON.stringify(envelope)
    const actualBytes = new TextEncoder().encode(serialized).byteLength
    if (actualBytes > JOB_STATE_LIMITS.maxSerializedBytes) {
      return rejected({
        code: "STORAGE_BYTES_EXCEEDED",
        actualBytes,
        limitBytes: JOB_STATE_LIMITS.maxSerializedBytes,
      })
    }
    if (parseStoredJobEnvelope(serialized) === undefined) {
      return rejected({ code: "STORAGE_MALFORMED" })
    }
    try {
      await this.#storage.set({ [JOB_STORAGE_KEY]: serialized })
      return { kind: "ok", value: jobs }
    } catch (error) {
      const cause = error instanceof Error ? error.name : "UnknownStorageRejection"
      return rejected({ code: "STORAGE_WRITE_REJECTED", cause })
    }
  }

  async #clear(): Promise<JobStoreResult<readonly ActiveJobState[]>> {
    try {
      await this.#storage.remove(JOB_STORAGE_KEY)
      return { kind: "ok", value: [] }
    } catch (error) {
      const cause = error instanceof Error ? error.name : "UnknownStorageRejection"
      return rejected({ code: "STORAGE_WRITE_REJECTED", cause })
    }
  }
}
