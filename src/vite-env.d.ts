declare module "*.css?inline" {
  const content: string
  // biome-ignore lint/style/noDefaultExport: Vite inline CSS modules expose a default string export.
  export default content
}
