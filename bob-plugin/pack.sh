#!/bin/sh
set -eu

plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname "$plugin_dir")
output_dir="$project_dir/output"
package_path="$output_dir/SceneCards-0.1.0.bobplugin"

mkdir -p "$output_dir"
rm -f "$package_path"
cd "$plugin_dir"
zip -q "$package_path" info.json main.js
printf '%s\n' "$package_path"
