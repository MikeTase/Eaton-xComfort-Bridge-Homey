# Changelog

## 2026-02-20

### Fixes
- Fixed crash when WebSocket is closed before connection is established (cleanup now absorbs async error events)

## 2026-02-05

### Improvements
- Pairing UX polish across device types (consistent status/empty/error messaging)
- Added room pairing templates
- Settings UI validation and show/hide auth key
- Safer connection handling and cleaner logging

### Fixes
- Room listener cleanup on delete
- Shading position updates normalized
- Build fix for actuator timestamp usage
