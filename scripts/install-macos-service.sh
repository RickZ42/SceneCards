#!/bin/sh
set -eu

label="com.rick.scenecards"
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_plist="$project_dir/macos/$label.plist"
target_plist="$HOME/Library/LaunchAgents/$label.plist"
runtime_dir="$HOME/Library/Application Support/SceneCards"
token_file="$runtime_dir/data/lan-token"
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
if [ ! -s "$token_file" ]; then
  umask 077
  openssl rand -hex 24 > "$token_file"
fi
lan_token=$(tr -d '\r\n' < "$token_file")
plutil -lint "$source_plist" >/dev/null
install -m 0644 "$source_plist" "$target_plist"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:SCENECARDS_HOST string 0.0.0.0" "$target_plist"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:SCENECARDS_LAN_TOKEN string $lan_token" "$target_plist"

if launchctl print "$domain/$label" >/dev/null 2>&1; then
  launchctl bootout "$domain/$label"
fi
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
lan_ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
if [ -n "$lan_ip" ]; then
  printf 'Private phone URL: http://%s:5173/?access=%s\n' "$lan_ip" "$lan_token"
fi
