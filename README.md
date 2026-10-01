# SSH Key Manager

Ứng dụng cho Windows và macOS giúp **tạo, quản lý và kiểm tra SSH key** mà không phải nhớ lệnh `ssh-keygen`, `ssh-add` hay tự sửa file `~/.ssh/config`. Có giao diện đồ hoạ và CLI `skm` đi kèm.

Ứng dụng không tự cài thuật toán mật mã nào: mọi thao tác đều gọi OpenSSH có sẵn của hệ điều hành.

![Trang Keys](docs/screenshots/keys-light.png)

## Tải về

Vào [Releases](../../releases/latest) và tải file cho máy của bạn.

**Windows:** `SSH-Key-Manager-<version>-portable.exe`. File chạy ngay, không cần cài đặt.
- Cần Windows 10/11 x64 có **OpenSSH Client**. Windows đã cài sẵn; kiểm tra bằng `ssh -V`.
- File chưa ký số nên SmartScreen sẽ cảnh báo. Bấm *More info*, rồi *Run anyway*.

**macOS** (khi Release có bản build cho Mac): `SSH-Key-Manager-<version>-arm64.dmg` cho Mac chip Apple (M1 trở lên), `-x64.dmg` cho Mac chip Intel. Mở file `.dmg` rồi kéo app vào *Applications*.
- App chưa được Apple công chứng (notarize), nên lần đầu mở macOS sẽ chặn. Vào **System Settings → Privacy & Security**, kéo xuống và bấm **Open Anyway**. Hoặc chạy trong Terminal:
  ```sh
  xattr -dr com.apple.quarantine "/Applications/SSH Key Manager.app"
  ```
- Dùng OpenSSH có sẵn của macOS (`/usr/bin`); nếu không có thì dùng bản Homebrew.

Trên cả hai hệ điều hành:
- App làm việc với thư mục SSH thật (`~/.ssh`). Nếu chỉ muốn thử, vào **Cài đặt** chọn một thư mục khác. Thanh trạng thái luôn cho biết đang dùng thư mục nào.
- Nếu thư mục SSH chưa có, app tự tạo.

## Tính năng

### Tạo key
Bấm **Ctrl+N** (macOS: **⌘N**), đặt tên và (nên) đặt passphrase. Hỗ trợ Ed25519 (mặc định), RSA 3072/4096, ECDSA. App không bao giờ ghi đè key có sẵn. Tạo xong có thể copy public key, hoặc tạo luôn một khối Host trong config cho key đó.

![Tạo key](docs/screenshots/generate-light.png)

### Quản lý key
Trang **Keys** liệt kê mọi key với fingerprint, loại key, ngày tạo, có passphrase hay không, kèm tag và ghi chú của bạn. Từ đây bạn có thể copy public key, đổi hoặc bỏ passphrase, đổi tên, xoá (có xác nhận), hoặc kéo thả file để import.

Private key bị người khác đọc được thì OpenSSH sẽ từ chối dùng. App phát hiện chuyện này và sửa bằng nút **Sửa tất cả**.

![Key có quyền không an toàn](docs/screenshots/keys-unsafe-light.png)

### ssh-agent
Xem trạng thái ssh-agent, thêm key vào agent (chỉ nhập passphrase một lần) và gỡ key.

**Windows:** mặc định Windows để service ssh-agent ở trạng thái *Disabled*. Lần đầu, bấm **Khởi động** rồi **Bật bằng quyền Administrator**, hoặc chạy PowerShell bằng *Run as administrator*:

```powershell
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

ssh-agent của Windows giữ các key đã thêm cả sau khi khởi động lại máy. Gỡ key khi không còn dùng.

**macOS:** ssh-agent luôn có sẵn (launchd tự chạy), không cần bật. Agent quên key khi bạn đăng xuất. Khi thêm key có passphrase, chọn **Lưu passphrase vào Keychain** (CLI: `skm agent add <key> --keychain`), rồi thêm vào khối Host trong config:
```
UseKeychain yes
AddKeysToAgent yes
```
Khi đó ssh tự lấy passphrase từ Keychain, không hỏi lại sau khi khởi động lại máy.

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

- Chưa hỗ trợ Linux.
- **Bản macOS chưa được chạy thử trên máy Mac thật.** Code và unit test đã có, nhưng việc build `.dmg` và các luồng như thêm key có passphrase vào agent, Keychain, sửa quyền file cần được kiểm tra trên Mac. Xem mục [Build và chạy thử trên macOS](#build-và-chạy-thử-trên-macos) để kiểm tra giúp và báo lại.
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
npm run dist         # Windows: đóng gói exe portable vào release\
npm run dist:mac     # macOS (phải chạy trên Mac): 2 file .dmg arm64 + x64, ký ad-hoc
npm run cli -- --help        # chạy CLI sau khi build
```

Chạy từ terminal của VS Code thì xoá biến `ELECTRON_RUN_AS_NODE` trước (`Remove-Item Env:ELECTRON_RUN_AS_NODE`), nếu không Electron sẽ báo `bad option`.

### Build và chạy thử trên macOS

Bản macOS chưa được kiểm chứng trên máy Mac thật, nên ai có Mac hãy làm theo các bước dưới đây và báo lại kết quả. Cần macOS 12 trở lên, Node.js 20.19+, và Xcode Command Line Tools (`xcode-select --install`).

**1. Lấy code và cài đặt**
```sh
git clone git@github.com:TeamAcMong/ssh-key-manager.git
cd ssh-key-manager
npm install
ls -l resources/askpass/askpass.sh   # phải có quyền chạy (-rwxr-xr-x)
```
Nếu `askpass.sh` không có quyền chạy, chạy `chmod +x resources/askpass/askpass.sh`. Thiếu quyền này thì thêm key có passphrase vào agent sẽ lỗi.

**2. Chạy test tự động**
```sh
npm run typecheck
npm test                     # unit test, gồm cả test chạy ssh-keygen thật trong .tmp-test
npm run build && npm run e2e # mở app thật trong thư mục sandbox
```

**3. Chạy app ở chế độ dev và thử tay**
```sh
npm run dev                  # dùng ./sandbox-ssh, không đụng ~/.ssh thật
```
Những phần cần thử tay:
- [ ] ⌘N mở hộp thoại tạo key; tạo một key **có passphrase**.
- [ ] Trang **ssh-agent** báo "Đang chạy"; thêm key vừa tạo (nhập passphrase), key hiện trong danh sách; gỡ key được.
- [ ] Thêm lại key với ô **Lưu passphrase vào Keychain**; mở *Keychain Access*, tìm "SSH" để thấy mục vừa lưu.
- [ ] Chạy `chmod 644 sandbox-ssh/<tên key>`, bấm F5: app báo quyền không an toàn; bấm **Sửa tất cả** thì file về `-rw-------`.
- [ ] ⌘C / ⌘V trong ô nhập liệu, ⌘Q thoát app.
- [ ] Trang **Kiểm tra kết nối** với `git@github.com`.
- [ ] CLI: `npm run cli -- --ssh-dir ./sandbox-ssh agent add <key> --keychain`.

**4. Đóng gói `.dmg`**
```sh
npm run dist:mac
```
Kết quả nằm trong `release/`: `SSH-Key-Manager-<version>-arm64.dmg` và `SSH-Key-Manager-<version>-x64.dmg`. App được ký ad-hoc (`identity: "-"`), không notarize. Mở file `.dmg`, kéo app vào *Applications*, mở lần đầu bằng **System Settings → Privacy & Security → Open Anyway**, rồi lặp lại phần thử tay ở bước 3, lần này với bản đã đóng gói. Riêng việc thêm key có passphrase vào agent là bắt buộc phải thử, vì nó kiểm tra `askpass.sh` vẫn giữ quyền chạy sau khi đóng gói.

**5. Báo kết quả**
Tạo issue trên GitHub, ghi rõ phiên bản macOS, loại chip (Apple/Intel) và kết quả `ssh -V`; nếu có lỗi thì đính kèm thông báo lỗi. Đóng gói chạy tốt thì đưa 2 file `.dmg` lên Release của phiên bản tương ứng.

Mã nguồn: `src/core` (lõi dùng chung cho GUI và CLI), `src/main` (Electron main + IPC), `src/preload`, `src/renderer` (React + Fluent UI), `src/cli`, `tests/unit`, `tests/e2e`.
