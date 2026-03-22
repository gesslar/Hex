import uglify from "@gesslar/uglier"

export default [
   {ignores: ["**/vendor/**"]},
  ...uglify({
    with: [
      "lints-js", // default files: ["**/*.{js,mjs,cjs}"]
      "lints-jsdoc", // default files: ["**/*.{js,mjs,cjs}"]
      "vscode-extension", // default files: ["src/**/*.{js,mjs,cjs}"]
      "web", // default files: ["src/**/*.{js,mjs,cjs}"]
    ],
  })
]
