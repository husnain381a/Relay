# October 29 continuation

The local application now also includes:

- A schema-based Tiptap visual editor with Markdown source/preview, formatting, user/channel pickers, safe paste handling and message-length validation.
- Independent thread read cursors, explicit follow/unfollow, follower/mention notifications, thread participant summaries, an unread Threads section, and channel reads that preserve unseen thread replies.
- Durable, user-isolated text drafts. Unchanged failed sends retain their client UUID in the browser session for safe retries; pending File objects remain local to the active page.
- Paginated saved items, files, activity, scheduled messages and subscribed threads. Saved-state hydration scans all authorized IDs instead of truncating at 100.
- Private profile photos and workspace logos, actual raster validation/resize/re-encode, ownership checks and expiring signed display URLs.
- Versioned private real-time topics. Membership removal rotates topic epochs, the previous topic receives an empty rekey control, and subsequent activity goes only to the new topic. Clients reauthorize and reconcile after rekey; stale async socket callbacks cannot commit.

New SQL checks execute all migrations and verify private threads/drafts/media, exact unread counts, topic revocation and subsequent publication routing. Browser tests use explicitly development-gated editor/image fixtures and never simulate or write to a backend. Those fixture routes return not-found in production, even if their development enable flag is set.

Hosted Auth/Storage/WebSockets, deployment, load testing and a signed Windows release still need the dedicated backend and infrastructure access. A successful local test suite is not evidence those services have been validated.
