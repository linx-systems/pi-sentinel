#!/bin/bash
# Package source code for Firefox Add-on submission
# Creates a zip of source files for AMO review

set -e

cd "$(dirname "$0")/.."

OUTPUT="pisentinel-source.zip"
rm -f "$OUTPUT"

zip -r "$OUTPUT" \
	entrypoints/ \
	background/ \
	components/ \
	utils/ \
	public/ \
	package.json \
	wxt.config.ts \
	tsconfig.json \
	vitest.config.ts \
	eslint.config.js \
	.prettierrc.json \
	README.md \
	LICENSE.txt \
	.gitignore \
	.env.example

echo ""
echo "Created $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
