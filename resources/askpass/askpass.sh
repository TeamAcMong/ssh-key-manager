#!/bin/sh
# SSH_ASKPASS entry point on macOS: runs askpass.js with the runtime given by the app.
exec "$SKM_ASKPASS_NODE" "$(dirname "$0")/askpass.js" "$@"
