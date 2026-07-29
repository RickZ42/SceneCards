#!/bin/sh
set -eu

label="com.rick.scenecards"
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_plist="$project_dir/macos/$label.plist"
target_plist="$HOME/Library/LaunchAgents/$label.plist"
runtime_dir="$HOME/Library/Application Support/SceneCards"
domain="gui/$(id -u)"

cd "$project_dir"
npm run build
mkdir -p \
  "$HOME/Library/LaunchAgents" \
  "$HOME/Library/Logs/SceneCards" \
  "$runtime_dir/dist" \
  "$runtime_dir/data"
install -m 0644 "$project_dir/server.mjs" "$runtime_dir/server.mjs"
cp -R "$project_dir/dist/." "$runtime_dir/dist/"
if [ -f "$project_dir/data/bob-inbox.json" ] && [ ! -f "$runtime_dir/data/bob-inbox.json" ]; then
  install -m 0644 "$project_dir/data/bob-inbox.json" "$runtime_dir/data/bob-inbox.json"
fi
plutil -lint "$source_plist" >/dev/null
if launchctl print "$domain/$label" >/dev/null 2>&1; then
  launchctl bootout "$domain/$label"
  sleep 1
fi
install -m 0644 "$source_plist" "$target_plist"

attempt=1
while ! launchctl bootstrap "$domain" "$target_plist"; do
  if [ "$attempt" -ge 3 ]; then
    printf 'Could not register the SceneCards background service.\n' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done
launchctl kickstart -k "$domain/$label"
printf 'SceneCards background service installed.\n'
