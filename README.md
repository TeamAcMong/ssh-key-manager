# SSH Key Manager

Ứng dụng Windows giúp **tạo, quản lý và kiểm tra SSH key** mà không phải nhớ lệnh `ssh-keygen`, `ssh-add` hay tự sửa file `~/.ssh/config`. Có giao diện đồ hoạ và CLI `skm` đi kèm.

Ứng dụng không tự cài thuật toán mật mã nào: mọi thao tác đều gọi OpenSSH có sẵn của Windows.

![Trang Keys](docs/screenshots/keys-light.png)

## Tải về

Vào [Releases](../../releases/latest) và tải `SSH-Key-Manager-<version>-portable.exe`. File chạy ngay, không cần cài đặt.

- Cần Windows 10/11 x64 có **OpenSSH Client**. Windows đã cài sẵn; kiểm tra bằng `ssh -V`.
- File chưa ký số nên SmartScreen sẽ cảnh báo. Bấm *More info*, rồi *Run anyway*.
- App làm việc với thư mục SSH thật (`%USERPROFILE%\.ssh`). Nếu chỉ muốn thử, vào **Cài đặt** chọn một thư mục khác. Thanh trạng thái luôn cho biết đang dùng thư mục nào.
- Nếu thư mục SSH chưa có, app tự tạo.

## Tính năng

### Tạo key
Bấm **Ctrl+N**, đặt tên và (nên) đặt passphrase. Hỗ trợ Ed25519 (mặc định), RSA 3072/4096, ECDSA. App không bao giờ ghi đè key có sẵn. Tạo xong có thể copy public key, hoặc tạo luôn một khối Host trong config cho key đó.

![Tạo key](docs/screenshots/generate-light.png)

### Quản lý key
Trang **Keys** liệt kê mọi key với fingerprint, loại key, ngày tạo, có passphrase hay không, kèm tag và ghi chú của bạn. Từ đây bạn có thể copy public key, đổi hoặc bỏ passphrase, đổi tên, xoá (có xác nhận), hoặc kéo thả file để import.

Private key bị người khác đọc được thì OpenSSH sẽ từ chối dùng. App phát hiện chuyện này và sửa bằng nút **Sửa tất cả**.

![Key có quyền không an toàn](docs/screenshots/keys-unsafe-light.png)

### ssh-agent
Xem trạng thái service ssh-agent của Windows, khởi động nó, thêm key vào agent (chỉ nhập passphrase một lần) và gỡ key.

Mặc định Windows để ssh-agent ở trạng thái *Disabled*. Lần đầu, bấm **Khởi động** rồi **Bật bằng quyền Administrator**, hoặc chạy PowerShell bằng *Run as administrator*:

```powershell
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

ssh-agent của Windows giữ các key đã thêm cả sau khi khởi động lại máy. Gỡ key khi không còn dùng.

### Sửa `~/.ssh/config`
Thêm, sửa, xoá khối Host bằng form. Comment và các dòng app không quản lý được giữ nguyên. Trước khi ghi, app luôn **hiện diff** để bạn xem và tự sao lưu file cũ thành `config.<thời gian>.bak`.

![Diff trước khi ghi](docs/screenshots/config-diff-light.png)

**Mẫu dịch vụ:** khi thêm Host, chọn một dịch vụ để điền sẵn HostName, User và Port. Có mẫu cho GitHub, GitLab, Bitbucket (cả bản qua port 443 khi mạng chặn port 22), Azure DevOps, AWS CodeCommit, AWS EC2, Codeberg, Hugging Face và Linux server/VPS. Với dịch vụ không có địa chỉ cố định như AWS, form ghi rõ giá trị nào phải tự điền và lấy ở đâu.

![Mẫu dịch vụ](docs/screenshots/config-preset-light.png)

### Kiểm tra kết nối
Chọn một Host rồi bấm **Chạy** để xem key có đăng nhập được không. Lỗi được giải thích bằng tiếng Việt, kèm nút sửa nhanh: sửa quyền file, thêm key vào agent, khởi động agent.

Lần đầu kết nối tới một máy chủ mới, host key của nó chưa có trong `known_hosts`:
- **GitHub, GitLab, Bitbucket:** app đối chiếu host key với fingerprint mà nhà cung cấp công bố. Khớp thì tự thêm và chạy lại; không khớp thì từ chối, vì có thể đang bị giả mạo máy chủ.
- **Máy chủ khác** (Hugging Face, EC2, VPS…): app hiện fingerprint để bạn xác nhận rồi thêm bằng một nút bấm.
- Muốn ssh tự xử lý lần đầu kết nối, kể cả khi chạy `git clone`/`git push`: đặt **StrictHostKeyChecking = accept-new** cho Host đó trong trang Config. Host tạo từ mẫu dịch vụ đã được chọn sẵn. Nếu sau này host key bị đổi, ssh vẫn chặn.

![Kiểm tra kết nối](docs/screenshots/test-light.png)

### Giao diện
Tiếng Việt, giao diện sáng, tối hoặc theo hệ thống, hiển thị tốt ở DPI 150% và 200%.

## An toàn

- Private key không bao giờ được gửi lên giao diện, không bao giờ vào clipboard, log hay thông báo lỗi.
- Passphrase không xuất hiện trong dòng lệnh hay biến môi trường của tiến trình.
- Mọi thao tác chỉ diễn ra bên trong thư mục SSH đã chọn.
- App sao lưu `config` và `known_hosts` trước mỗi lần ghi. Xoá key hay ghi config đều phải xác nhận.
- Khi lấy host key, app không gửi key hay mật khẩu nào lên máy chủ.
- App không kết nối Internet, trừ lúc bạn chủ động kiểm tra kết nối.

## CLI `skm`

Có đủ các thao tác chính để dùng trong terminal hoặc script:

| Lệnh | Việc làm |
|---|---|
| `skm gen [-t ed25519\|rsa\|ecdsa] [-b bits] [-C comment] [-f tên]` | Tạo key (hỏi passphrase ẩn; `--passphrase-stdin` cho script) |
| `skm list` / `skm info <key>` | Liệt kê key / xem fingerprint, public key (`--json` nếu cần) |
| `skm fix-perms <key…> \| --all` | Sửa quyền file private key |
| `skm agent status \| start \| list \| add <key> \| remove <key>` | Quản lý ssh-agent |
| `skm config list \| show \| add <alias> \| set <alias> \| rm <alias>` | Sửa config, luôn in diff và hỏi xác nhận (`-y` để bỏ qua) |
| `skm test <host>` | Kiểm tra kết nối |

Dùng `--ssh-dir <thư mục>` để làm việc với thư mục SSH khác. Xem đầy đủ tuỳ chọn bằng `skm --help`.

## Hạn chế

- Chỉ chạy trên Windows.
- Trên Windows không phải tiếng Anh, hoặc với tên tài khoản có dấu, kết quả kiểm tra quyền file có thể không chính xác.
- Thông báo lỗi luôn bằng tiếng Việt; bản tiếng Anh mới dịch một phần.
- Chưa có: khoá FIDO2, quản lý/xoá dòng cũ trong `known_hosts`, upload key lên GitHub/GitLab. Xem [docs/BACKLOG.md](docs/BACKLOG.md).

## Dành cho người phát triển

Cần Node.js 20.19 trở lên.

```powershell
npm install          # nếu thiếu electron.exe: node node_modules/electron/install.js
npm run dev          # chạy app; dùng .\sandbox-ssh và .\.dev-appdata, không đụng dữ liệu thật
npm run typecheck
npm test             # unit test (Vitest)
npm run build; npm run e2e   # e2e (Playwright), chụp lại ảnh trong docs/screenshots
npm run dist         # đóng gói exe portable vào release\
npm run cli -- --help        # chạy CLI sau khi build
```

Chạy từ terminal của VS Code thì xoá biến `ELECTRON_RUN_AS_NODE` trước (`Remove-Item Env:ELECTRON_RUN_AS_NODE`), nếu không Electron sẽ báo `bad option`.

Mã nguồn: `src/core` (lõi dùng chung cho GUI và CLI), `src/main` (Electron main + IPC), `src/preload`, `src/renderer` (React + Fluent UI), `src/cli`, `tests/unit`, `tests/e2e`.
