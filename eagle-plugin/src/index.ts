import { createInspector, renderState } from "./plugin"

const eagle = window.eagle
if (eagle === undefined) {
  renderState({ kind: "unsupported", reason: "Eagle API is not available." })
} else {
  createInspector(eagle, renderState)
}
