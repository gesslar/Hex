import uglify from "@gesslar/uglier"

export default [
  ...uglify({
    with: [
      "lints-js", // default files: ["**/*.{js,mjs,cjs}"]
      "lints-jsdoc", // default files: ["**/*.{js,mjs,cjs}"]
      "vscode-extension", // default files: ["src/**/*.{js,mjs,cjs}"]
      "web", // default files: ["src/**/*.{js,mjs,cjs}"]
    ],
    overrides: {
      "lints-js": {ignores: ["src/**/vendor"]},
      "lints-jsdoc": {ignores: ["src/**/vendor"]},
      "vscode-extension": {ignores: ["src/**/vendor"]},
      "web": {ignores: ["src/**/vendor"]},
    }
  })
]
