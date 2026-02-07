# Hex

**Because while you may be valid, your theme is questionable.**

Hex is a Visual Studio Code extension that validates colour theme files against
the official VS Code workbench colour schema. It catches format errors, flags
deprecated properties, and shows how much of the available colour palette your
theme actually covers.

<video src="Hex.webm" autoplay loop muted></video>

## Features

### Schema-Aware Validation

Hex loads the workbench colour schema directly from your running VS Code
instance and checks each colour property in your theme file for:

- **Format correctness** -- hex colours must be `#RGB`, `#RGBA`, `#RRGGBB`,
  `#RRGGBBAA`, or the literal `default`
- **Transparency requirements** -- some properties require an alpha channel
  (8-digit hex) to avoid obscuring editor content
- **Deprecated properties** -- properties marked for removal in the schema are
  flagged as warnings
- **Unknown properties** -- anything not in the schema is flagged as invalid

### Live Revalidation

Hex watches the validated file for changes and revalidates automatically. Edit
your theme, and the results refresh without needing to re-run anything.

### Filtering and Search

The built-in filter bar supports:

- **Text search** by property name
- **Match Case** toggle
- **Regular Expression** toggle
- **Errors only** filter (may be paired with warnings)
- **Warnings only** filter (may be paired with errors)

Error and warning counts are always visible in the filter bar.

### Click-to-Navigate

Click any validation result to jump directly to that property in the editor.
Hex finds the property definition, highlights it, and brings the editor into
focus.

### Coverage Statistics

Hex shows how many colour properties your theme defines relative to the full
set of available workbench colours, giving you a quick sense of how
comprehensive your theme is.

## Usage

### Commands

| Command | Description |
| --- | --- |
| `Hex: Show Hex` | Open the Hex panel |
| `Validate selected theme file in Hex` | Validate the currently selected `.json` file |
| `Open and validate theme file in Hex` | Open a file picker to choose a theme file |

### Accessing Commands

- **Command Palette** -- search for "Hex"
- **Editor toolbar** -- the validate icon appears in the title bar when a
  `.json` file is open
- **Explorer context menu** -- right-click any `.json` file in the file
  explorer

### Theme File Format

Hex expects a JSON file with a top-level `colors` object:

```json
{
  "colors": {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "activityBar.background": "#333333"
  }
}
```

### Development

Fork the repository and install dependencies:

```bash
gh repo fork gesslar/Hex
cd Hex
pnpm install
```

Open the project in VS Code and press F5 to launch the Extension Development Host.

Lint with:

```bash
pnpm exec eslint .
```

## License

Hex itself is released into the public domain under the [Unlicense](UNLICENSE.txt).

This extension includes or depends on third-party components under their own
licenses:

| Dependency | License |
| --- | --- |
| [@vscode/codicons](https://github.com/microsoft/vscode-codicons) | CC-BY-4.0 |
| [ajv](https://github.com/ajv-validator/ajv) | MIT |
| [json5](https://github.com/json5/json5) | MIT |
| [yaml](https://github.com/eemeli/yaml) | ISC |
| [@gesslar/toolkit](https://github.com/gesslar/toolkit) | Unlicense |
