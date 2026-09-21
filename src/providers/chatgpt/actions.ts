import type { ProviderAction } from "../types"
import { CHATGPT_SELECTORS } from "./selectors"

const ACTION_TIMEOUT = 3000

function waitFor<T>(find: () => T | undefined, description: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = (): void => {
      const value = find()
      if (value !== undefined) {
        resolve(value)
        return
      }
      if (Date.now() - started >= ACTION_TIMEOUT) {
        reject(new Error(`ChatGPT did not expose ${description}.`))
        return
      }
      window.setTimeout(check, 50)
    }
    check()
  })
}

export function chatGptEditAndResend(userTurn: Element): ProviderAction {
  return {
    kind: "edit_and_resend",
    label: "Edit and resend",
    run: async () => {
      const edit = userTurn.querySelector(CHATGPT_SELECTORS.editMessage)
      if (!(edit instanceof HTMLElement)) {
        throw new Error("ChatGPT edit action is unavailable.")
      }
      edit.click()

      await waitFor(
        () => userTurn.querySelector(CHATGPT_SELECTORS.editComposer),
        "the message editor",
      )
      const send = await waitFor(() => {
        return [...userTurn.querySelectorAll("button")].find(
          (button) =>
            button.classList.contains("btn-primary") &&
            !button.hasAttribute("disabled"),
        ) as HTMLElement | undefined
      }, "the Send button")
      send.click()
    },
  }
}
