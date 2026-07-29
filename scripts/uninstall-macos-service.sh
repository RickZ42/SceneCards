#!/bin/sh
set -eu

label="com.rick.scenecards"
target_plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
rm -f "$target_plist"
printf 'SceneCards background service removed.\n'
