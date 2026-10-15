# AgentLogistics Sites gateway

Fixed public Site proxies requests to the local Agent service over an HTTPS tunnel. No model keys or user cookies are stored in the deployed code.

Runtime variable: BACKEND_URL (HTTPS tunnel origin). After updating this value, redeploy the saved version. The local service must allow the tunnel hostname through PUBLIC_HOSTNAMES. Keep the local Node/Rust service and SSH tunnel running.

Build: node scripts/build.mjs && node scripts/validate-artifact.mjs
