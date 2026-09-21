import type { ProviderAction } from "../types"
import { GEMINI_SELECTORS } from "./selectors"

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
        reject(new Error(`Gemini did not expose ${description}.`))
        return
      }
      window.setTimeout(check, 50)
    }
    check()
  })
}

function menuAction(model: Element, iconName: string, label: string): ProviderAction {
  return {
    kind: iconName === "refresh" ? "regenerate" : "personalize",
    label,
    run: async () => {
      const trigger = model.querySelector(GEMINI_SELECTORS.regenerateTrigger)
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Gemini action menu is unavailable.")
      }
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click()

      const menuId = trigger.getAttribute("aria-controls")
      const option = await waitFor(() => {
        const menu = menuId === null ? undefined : document.getElementById(menuId)
        return [...(menu?.querySelectorAll(GEMINI_SELECTORS.regenerateOption) ?? [])].find(
          (candidate) =>
            candidate.querySelector(`mat-icon[data-mat-icon-name='${iconName}']`) !== null,
        ) as HTMLElement | undefined
      }, label)
      option.click()
    },
  }
}

export function geminiActions(model: Element): readonly ProviderAction[] {
  return [
    menuAction(model, "refresh", "Try again"),
    menuAction(model, "personal_recommendations", "Personalize"),
  ]
}
