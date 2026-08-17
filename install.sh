#!/bin/sh
set -eu

repo_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)"
app_dir="/Users/sota/Applications/LifeShifter.app"
agent_file="/Users/sota/Library/LaunchAgents/com.sota.lifeshifter.plist"

[ "$repo_dir" = "/Users/sota/projects/apps/日々のFB管理APP" ]
[ "$(dirname "$app_dir")" = "/Users/sota/Applications" ]
[ "$(basename "$app_dir")" = "LifeShifter.app" ]
[ "$(dirname "$agent_file")" = "/Users/sota/Library/LaunchAgents" ]

cd "$repo_dir"
swift build -c release
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" "$(dirname "$agent_file")"
pkill -x LifeShifter 2>/dev/null || true
install -m 755 .build/release/LifeShifter "$app_dir/Contents/MacOS/LifeShifter"
install -m 644 AppInfo.plist "$app_dir/Contents/Info.plist"
install -m 644 com.sota.lifeshifter.plist "$agent_file"
launchctl bootout "gui/$(id -u)/com.sota.lifeshifter" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$agent_file"
