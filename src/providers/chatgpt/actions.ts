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

export function chatGptRegenerate(userTurn: Element): ProviderAction {
  return {
    kind: "regenerate",
    label: "Regenerate image",
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
        const labelled = userTurn.querySelector(CHATGPT_SELECTORS.sendMessage)
        if (labelled instanceof HTMLElement && !labelled.hasAttribute("disabled")) {
          return labelled
        }
        return [...userTurn.querySelectorAll("button")].find(
          (button) =>
            !button.hasAttribute("disabled") &&
            (button.getAttribute("aria-label") === "Send" ||
              button.textContent?.trim() === "Send"),
        ) as HTMLElement | undefined
      }, "the Send button")
      send.click()
    },
  }
}
