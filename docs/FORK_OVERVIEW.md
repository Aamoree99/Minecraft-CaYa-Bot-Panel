# CaYa fork: fix/worker-gameplay-reliability

This branch contains reviewed changes extracted from private development, retaining original code-commit attribution through Source-commit trailers. Internal operational documentation, credentials, player configuration, live inventories and logs are intentionally excluded. Original complete history is retained in a protected local Git bundle.

Base: 012ff0dd1f2b54a3c316b9e2d84a519ea99e3640. Branches are stacked in this order: fix/gameplay-reliability → fix/caya-updater → compat/minecraft-26.3 → feat/worker-autonomy → feat/multibot-cooperation → fix/worker-gameplay-reliability → fix/ollama-tool-calling. The personality branch is independent on upstream d7f0dee. Integration merges personality with the last stack. Review a branch against its recorded base, not against upstream alone.

Compatibility uses verified @wp2508 source archives plus versioned vendor patches. These inherited protocol changes are credited to their original maintainers; this fork does not claim authorship of the entire Minecraft 26.3 implementation. Library patches are also published separately in Aamoree99/mineflayer, Aamoree99/node-minecraft-data and Aamoree99/prismarine-chunk. Vendor bootstrap remains the reproducible dependency mechanism; GitHub source branches are not substituted for locked npm artifacts.

Build: on native branches run `npm run prepare:native-deps`, then `npm ci`, `npm run test:unit`, `npm run typecheck`, `npm run build`. Older baseline branches use npm ci directly. Requires Node22+ and Python3 for native bootstrap. Worker is opt-in through CAYA_WORKSPACE_FILE; supply a reviewed private Overworld workspace with owned/protected boxes and assigned containers. No real workspace is included.

Validation and limitations: branch-specific results are recorded in the final publication matrix. Earlier tests of integrated behavior are not tests of independently separated branches. No new gameplay tests were run for publication. Known unresolved issues include safe retreat when no safe loaded destination exists, an intermittent auto-eat null-item warning, cached warehouse freshness and unreliable model prose. A queued task is never proof of completion. AI and autopilot should remain disabled until explicitly configured and bounded. No plugin or server-administration permissions are granted by these changes.

Per-bot personality has a global fallback; examples in tests use synthetic identities. Ollama compatibility adds request-local think:false only for the verified model profile; it neither installs models nor modifies the Ollama server. Stock tools return scoped cached observations. A bounded Worker return does not establish general autonomous readiness.

No upstream pull requests or releases accompany these branches. Existing upstream licenses and attribution remain in place.
