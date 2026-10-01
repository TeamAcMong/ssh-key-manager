# Backlog

Các việc **chưa làm trong phase 1**. Mỗi mục có một mức ưu tiên:

| Mức | Ý nghĩa |
|---|---|
| **P1** | Nên làm ở phase kế tiếp: vá rủi ro bảo mật, hoặc giải quyết đúng những lỗi mà app đang báo cho người dùng |
| **P2** | Giá trị rõ ràng nhưng không gấp |
| **P3** | Làm khi có nhu cầu cụ thể |

Các interface hiện có (`PlatformPaths`, `FilePermissionService`, `AgentService`, `ProcessRunner`, `AskpassBroker`, và `SkmApi` trong `src/core/ipc.ts`) được thiết kế để thêm các mục dưới đây mà không phải sửa lõi.

---

## 1. Bảo mật & phát hành

| Ưu tiên | Việc | Ghi chú |
|---|---|---|
| P1 | Chạy thử và build bản macOS trên Mac thật | Code macOS đã có nhưng chưa chạy trên Mac: cần chạy `npm test`, `npm run e2e`, `npm run dist:mac`, rồi thử tay thêm key có passphrase vào agent (askpass.sh + Unix socket), Keychain, sửa quyền. Có thể dùng GitHub Actions runner macOS. |
| P1 | Tắt fuse `RunAsNode` của Electron | Hiện phải bật vì `askpass.cmd` chạy `electron.exe` ở chế độ Node. Cần một helper askpass riêng (exe nhỏ hoặc cơ chế khác) rồi mới tắt được. |
| P1 | Ký số file exe (code signing) | Để Windows SmartScreen không cảnh báo. Cần chứng chỉ ký code. |
| P1 | Kiểm tra ACL bằng SID thay vì tên nhóm | `icacls` in tên nhóm đã dịch trên Windows không phải tiếng Anh, và username có dấu có thể sai mã hoá. |
| P2 | Installer (electron-builder, NSIS) | Hiện chỉ có bản portable. |
| P2 | Tự động cập nhật (auto-update) | Phụ thuộc installer + code signing. |
| P2 | Khoá app bằng Windows Hello | |
| P2 | Audit log | Ghi lại thao tác (tạo, xoá, sửa quyền, ghi config…) và **không bao giờ** ghi secret. |
| P3 | Icon riêng cho ứng dụng | Hiện đang dùng icon mặc định của Electron. |

## 2. Quản lý key

| Ưu tiên | Việc | Ghi chú |
|---|---|---|
| P1 | Preset theo mục đích (GitHub / GitLab / Azure DevOps / server / signing) | Tự điền loại key, comment, tên file và Host alias tương ứng. |
| P1 | Phát hiện key yếu, trùng lặp, mồ côi | Key yếu: RSA dưới 3072 bit, DSA. Trùng: cùng fingerprint. Mồ côi: chỉ có `.pub` hoặc chỉ có private key. |
| P2 | Cảnh báo key quá cũ + quy trình xoay vòng key (rotation) | |
| P2 | Key FIDO2 (`ed25519-sk`, resident, verify-required) | `DetectedKeyType` đã có `ed25519-sk` / `ecdsa-sk`. |
| P2 | Chuyển đổi định dạng OpenSSH ↔ PuTTY `.ppk` ↔ PEM/PKCS8 | |
| P2 | Sao lưu và khôi phục key có mã hoá | |
| P3 | SSH certificate (CA, ký, thời hạn hiệu lực) | |

## 3. Kết nối & máy chủ

| Ưu tiên | Việc | Ghi chú |
|---|---|---|
| P1 | Trang quản lý `known_hosts` (xem, xoá dòng cũ khi máy chủ đổi key) | Phần thêm host key mới đã có từ v0.1.3: tự xác minh GitHub/GitLab/Bitbucket, xác nhận thủ công cho host khác, hoặc `StrictHostKeyChecking accept-new`. Còn thiếu cách xử lý lỗi "host key đã thay đổi". |
| P1 | Copy public key lên server (thay cho `ssh-copy-id`) | Đây là cách sửa trực tiếp cho lỗi "Permission denied (publickey)". |
| P2 | Chỉnh sửa `authorized_keys` trên máy chủ từ xa | |
| P2 | Hỗ trợ `ProxyJump` trong form Config | |
| P2 | Nhiều tài khoản GitHub bằng Host alias | Ví dụ `github-work` / `github-personal`, mỗi alias trỏ tới một key riêng. |

## 4. Tích hợp dịch vụ Git

| Ưu tiên | Việc | Ghi chú |
|---|---|---|
| P1 | Upload / liệt kê / thu hồi key qua API GitHub, GitLab, Bitbucket, Azure DevOps | Token chỉ được lưu bằng Electron `safeStorage` (DPAPI). |
| P1 | Thiết lập ký commit Git bằng SSH | Gồm `gpg.format ssh`, `user.signingkey`, và file `allowed_signers`. |

## 5. Tích hợp hệ thống

| Ưu tiên | Việc | Ghi chú |
|---|---|---|
| P2 | Phát hiện xung đột với agent khác (Pageant / 1Password / Bitwarden) | Kiểm tra `SSH_AUTH_SOCK` và named pipe `openssh-ssh-agent`. |
| P2 | Icon ở khay hệ thống (system tray) với thao tác nhanh cho agent | |
| P3 | Đồng bộ key sang WSL | |
| P3 | Tích hợp Windows Terminal / VS Code Remote-SSH | |
| P3 | Hỗ trợ macOS / Linux | Cài đặt các interface trong `src/core/platform` cho từng hệ điều hành. |

## 6. Nợ kỹ thuật phát hiện trong phase 1

| Ưu tiên | Việc | Ghi chú |
|---|---|---|
| P1 | e2e chụp ảnh trang ssh-agent khi agent đang giữ key thật | Windows chỉ có một agent dùng chung, nên ảnh sẽ lộ key thật. Cần che dữ liệu, hoặc bỏ qua ảnh khi agent có key không thuộc sandbox. |
| P2 | CLI thiếu lệnh xoá, đổi tên, đổi passphrase | Hiện các thao tác này chỉ có trong GUI. |
| P2 | Chưa test phần nhập passphrase ẩn của CLI trên terminal thật | Đã test nhánh `--passphrase-stdin`. |
| P2 | Hoàn thiện `en.json`; thông báo lỗi từ core luôn là tiếng Việt | |
| P3 | Dịch nhãn "Kiểu khởi động" (`AUTO_START`, `DISABLED`…) trên trang ssh-agent | |
| P3 | Giảm kích thước bundle renderer (khoảng 1.3 MB, chủ yếu là Fluent UI) | |
