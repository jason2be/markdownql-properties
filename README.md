# Properties

`com.markdownql.properties` is a first-party MarkdownQL extension distributed as an independent package and repository.

## Release

- Extension version: `1.1.1`
- Release tag: `v1.1.1`
- License: MIT
- Runtime package: `Properties.markdownqlextension`

## Development

Use the [MarkdownQL Extension SDK](https://github.com/jason2be/markdownql-extension-sdk) to validate the manifest, run Mock Host tests, and inspect compatibility before publishing a new version.

```sh
swift run --package-path /path/to/markdownql-extension-sdk \
  markdownql-extension-validate Properties.markdownqlextension
```

The package declares every executable module and resource in `manifest.json`. `Evolution/change.json` and `Evolution/replay.json` bind the current release to inspectable change and replay evidence.

## Source provenance

This repository was extracted from `jason2be/MarkdownQL` at commit `e6de96ffa960e16a47695e086f1c6a791853b540`. Future releases are versioned independently through this repository.

## License

The extension's original code is available under the MIT License. Bundled third-party components, when present, remain under their original licenses.
