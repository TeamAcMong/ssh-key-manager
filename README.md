# SSH Key Manager

Ứng dụng desktop (Windows) để **tạo và quản lý SSH key**. Có giao diện đồ hoạ (GUI) là sản phẩm chính và CLI `skm` đi kèm, cả hai dùng chung một lõi xử lý.

Ứng dụng **không tự cài đặt thuật toán mật mã nào**. Mọi thao tác với key đều gọi các công cụ OpenSSH có sẵn của Windows: `ssh-keygen`, `ssh-add`, `ssh`, `sc`, `icacls`.

![Trang Keys](docs/screenshots/keys-light.png)

## Tính năng (phase 1)

| Tính năng | GUI | CLI |
|---|---|---|
| Tạo key Ed25519 (mặc định), RSA 3072/4096, ECDSA 256/384/521; passphrase tuỳ chọn; không bao giờ ghi đè key có sẵn | Dialog "Tạo key mới" (Ctrl+N) | `skm gen` |
| Danh sách key: loại, số bit, fingerprint SHA256, comment, ngày tạo, có passphrase hay không, randomart; tag và ghi chú | Trang **Keys** | `skm list`, `skm info` |
| Copy public key, đổi hoặc bỏ passphrase, đổi tên, xoá (có hộp thoại xác nhận), import bằng kéo thả | Trang **Keys** | — |
| Phát hiện private key có quyền file (ACL) không an toàn và sửa bằng một cú bấm | Banner "Sửa tất cả" | `skm fix-perms` |
| Service ssh-agent của Windows: xem trạng thái, khởi động, thêm và gỡ key | Trang **ssh-agent** | `skm agent …` |
| Sửa `~/.ssh/config`: thêm, sửa, xoá khối Host; giữ nguyên comment và các dòng khác; **xem diff trước khi ghi** | Trang **Config** | `skm config …` |
| Mẫu dịch vụ điền sẵn HostName/User/Port: GitHub, GitLab, Bitbucket (cả bản port 443), Azure DevOps, AWS CodeCommit, AWS EC2, Codeberg, Hugging Face, VPS; kèm hướng dẫn các giá trị phải tự điền (region, SSH Key ID, DNS của instance…) | Trang **Config** → Thêm Host | — |
| `StrictHostKeyChecking accept-new` cho từng Host: lần đầu kết nối ssh tự thêm host key vào known_hosts, key bị đổi thì vẫn chặn | Trang **Config** (mẫu dịch vụ chọn sẵn) | `skm config add/set --strict-host-key-checking accept-new` |
| Kiểm tra kết nối `ssh -T -o BatchMode=yes`, giải thích lỗi bằng tiếng Việt | Trang **Kiểm tra kết nối** | `skm test` |
| Host chưa có trong known_hosts: GitHub/GitLab/Bitbucket được đối chiếu với fingerprint công bố rồi **tự thêm**; host khác hiện fingerprint để bạn xác nhận. Luôn sao lưu `known_hosts.<thời gian>.bak` trước khi ghi | Trang **Kiểm tra kết nối** | — |

Các tính năng sẽ làm sau (FIDO2, upload key lên GitHub/GitLab, installer…) chưa có trong phase 1.

## Yêu cầu

- Windows 10/11 x64, có **OpenSSH Client**. Mặc định Windows đã cài; kiểm tra bằng `ssh -V`.
- Node.js **20.19 trở lên** (đã thử với 26.8) và npm.
- Chỉ cần nếu muốn dùng ssh-agent: service `ssh-agent` phải được bật **một lần** bằng quyền Administrator (xem [Bật ssh-agent](#bật-ssh-agent)).

## Cài đặt

```powershell
npm install
```

npm 11 trở lên chặn install script chưa được duyệt, nên đôi khi binary của Electron không được tải về. Nếu `node_modules\electron\dist\electron.exe` chưa có, chạy thêm:

```powershell
node node_modules/electron/install.js
```

## Chạy khi phát triển

```powershell
npm run dev
```

> **Chạy từ terminal của VS Code?** VS Code đặt biến `ELECTRON_RUN_AS_NODE=1`, khiến Electron khởi động như Node thuần và báo lỗi `bad option`. Xoá biến trước khi chạy:
> PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE` · CMD: `set ELECTRON_RUN_AS_NODE=`

Ở chế độ dev, ứng dụng **không động vào dữ liệu thật**:

- Lần chạy đầu, thư mục SSH mặc định là `.\sandbox-ssh` của repo, không phải `%USERPROFILE%\.ssh`.
- Cài đặt, metadata và cache của Electron được lưu trong `.\.dev-appdata`, không phải `%APPDATA%`.

## Thư mục sandbox

Nên dùng một thư mục SSH riêng (sandbox) cho mọi lần thử nghiệm.

- **GUI:** vào **Cài đặt**, mục **Thư mục SSH**, bấm **Chọn thư mục…**. Thanh trạng thái hiện nhãn `SANDBOX`, hoặc `THƯ MỤC THẬT` khi đang dùng `%USERPROFILE%\.ssh`. Ở chế độ dev, trang Cài đặt còn hiện cảnh báo nếu bạn chọn thư mục thật.
- **CLI:** thêm `--ssh-dir .\sandbox-ssh` vào mọi lệnh.
- **Biến môi trường** (dùng cho test tự động):
  - `SKM_SSH_DIR`: ép thư mục SSH.
  - `SKM_APPDATA_DIR`: nơi lưu `settings.json` và `metadata.json`.

Mọi thao tác chỉ được phép diễn ra **bên trong** thư mục SSH đã chọn. Đường dẫn chứa `..`, `\` hay tên ổ đĩa đều bị từ chối.

## Dùng CLI

Build trước, rồi gọi CLI qua `npm run cli --` hoặc chạy trực tiếp bằng `node`:

```powershell
npm run build
npm run cli -- --help
node out/node/cli/index.js --ssh-dir .\sandbox-ssh list
```

| Lệnh | Việc làm |
|---|---|
| `skm gen [-t ed25519\|rsa\|ecdsa] [-b bits] [-C comment] [-f tên]` | Tạo key. Hỏi passphrase ẩn trên terminal; `--passphrase-stdin` đọc passphrase từ stdin; `--no-passphrase` tạo key không có passphrase |
| `skm list [--json]` | Liệt kê key |
| `skm info <key> [--json]` | Fingerprint, randomart, public key |
| `skm fix-perms <key…> \| --all` | Sửa quyền file private key |
| `skm agent status \| start \| list` | Trạng thái, khởi động, liệt kê key trong agent |
| `skm agent add <key> [--passphrase-stdin]` | Thêm key vào agent |
| `skm agent remove <key \| SHA256:…>` | Gỡ key khỏi agent |
| `skm config list \| show` | Xem các khối Host, hoặc nội dung nguyên văn của file |
| `skm config add <alias> [--hostname] [--user] [--port] [--identity <key>] [--identities-only yes\|no] [--strict-host-key-checking accept-new\|yes\|ask\|no] [-y]` | Thêm khối Host |
| `skm config set <alias> …` / `skm config rm <alias>` | Sửa hoặc xoá khối Host (truyền `""` để xoá một dòng) |
| `skm test <host> [--timeout giây]` | Kiểm tra kết nối |

Ví dụ:

```powershell
$env:SKM_APPDATA_DIR = ".dev-appdata"      # tuỳ chọn: không đụng %APPDATA%
node out/node/cli/index.js --ssh-dir .\sandbox-ssh gen -f id_ed25519_work
node out/node/cli/index.js --ssh-dir .\sandbox-ssh config add work --hostname github.com --user git --identity id_ed25519_work --identities-only yes
node out/node/cli/index.js --ssh-dir .\sandbox-ssh test work
```

Mọi lần ghi config đều in diff và hỏi xác nhận `[y/N]`. Khi chạy trong script không có terminal, phải thêm `-y` để xác nhận. Lệnh trả về mã thoát khác 0 khi có lỗi.

## Bật ssh-agent

Mặc định service `ssh-agent` của Windows ở trạng thái *Disabled*. Để bật, mở PowerShell bằng **Run as administrator** rồi chạy:

```powershell
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

Cách khác: trong app, vào trang **ssh-agent**, bấm **Khởi động**, rồi bấm **Bật bằng quyền Administrator (UAC)**.

> ssh-agent của Windows lưu các key đã thêm vào registry của tài khoản và **vẫn giữ chúng sau khi khởi động lại máy**. Gỡ key khi không còn dùng.

## Đóng gói file .exe

```powershell
npm run dist
```

Lệnh này tạo `release\SSH-Key-Manager-<version>-portable.exe`: một file duy nhất, chạy không cần cài (khoảng 100 MB). Mỗi lần mở, file tự giải nén vào `%TEMP%`.

- Bản exe dùng **thư mục SSH thật** (`%USERPROFILE%\.ssh`) và `%APPDATA%\ssh-key-manager`. Hãy đổi thư mục trong Cài đặt nếu chỉ muốn thử.
- File chưa ký số nên Windows SmartScreen sẽ cảnh báo. Bấm *More info*, rồi *Run anyway*.

## Kiểm thử

```powershell
npm run typecheck   # TypeScript: main/core/CLI, renderer, e2e
npm test            # Vitest: parser config, fingerprint, ghép cặp key, map lỗi, kiểm tra đường dẫn, và ssh-keygen/icacls thật trong .tmp-test
npm run build       # bắt buộc trước e2e
npm run e2e         # Playwright + Electron: mở từng trang, chụp ảnh vào docs/screenshots, kiểm tra bảo mật và DPI 150%/200%
```

- Test ssh-agent tự bỏ qua nếu service chưa chạy. Khi có chạy, test thêm rồi gỡ ngay một key tạo riêng trong sandbox.
- Chạy e2e trên bản exe đã đóng gói: `$env:SKM_E2E_EXE = "$PWD\release\win-unpacked\SSH Key Manager.exe"; npm run e2e`.
- Test chỉ dùng thư mục tạm trong `.tmp-test`. Test kết nối chỉ nhắm vào `127.0.0.1` với cổng đóng.

## Bảo mật

- **Electron:**
  - Bật `contextIsolation` và `sandbox`, tắt `nodeIntegration`.
  - CSP chặt: chỉ nạp script của chính app, không cho phép `eval`, không tải nội dung từ xa.
  - Chặn điều hướng, cửa sổ mới, `webview` và mọi request ra ngoài; từ chối mọi quyền (permission).
  - Phần giao diện (renderer) chỉ gọi được một API hẹp `window.skm.*`.
  - Các điểm trên đều có test e2e kiểm chứng.
- **Private key không bao giờ rời main process.** Qua IPC chỉ có metadata, fingerprint và public key. Clipboard từ chối nội dung private key.
- **Passphrase không nằm trong command line hay biến môi trường.** OpenSSH lấy passphrase qua helper `SSH_ASKPASS` (`resources/askpass`), helper này hỏi lại app qua một named pipe dùng một lần có kèm token. Ô nhập passphrase bị che và được xoá khỏi state ngay khi bấm gửi. CLI không bao giờ nhận passphrase qua tham số.
- **Không ghi passphrase hay private key vào log hoặc thông báo lỗi.** Chi tiết lỗi được redact (che các khối `PRIVATE KEY` và các secret đã biết). Log IPC chỉ ghi tên kênh và mã lỗi, không ghi payload.
- **Kiểm tra mọi dữ liệu IPC trong main.** Đường dẫn phải nằm trong thư mục SSH đã chọn; host truyền cho `ssh` không được bắt đầu bằng `-`.
- **Quyền file:** sau khi tạo hoặc import private key, app đặt ACL chỉ cho tài khoản hiện tại, bằng `icacls /inheritance:r /grant:r` và gỡ thêm các quyền cấp riêng cho người khác.
- **Host key:** app lấy host key bằng chính `ssh` vào một file known_hosts tạm, chỉ đề nghị phương thức xác thực `none`, nên không gửi key hay mật khẩu nào. Chỉ tự thêm khi khớp fingerprint mà GitHub/GitLab/Bitbucket công bố; không khớp thì từ chối (nghi tấn công xen giữa). Lời chào ẩn danh của Hugging Face (`Hi anonymous`) không được tính là đăng nhập thành công.
- **Sao lưu và xác nhận:** trước mỗi lần ghi `config` hoặc `known_hosts`, app sao lưu thành `<tên file>.<thời gian>.bak`. Xoá key hoặc ghi config đều cần xác nhận (hộp thoại native, diff, hoặc cờ `--yes`).
- **Không dùng shell:** mọi lệnh ngoài chạy bằng `spawn` với mảng tham số và `shell: false`.
- **Metadata không chứa key:** file metadata (`metadata.json`) chỉ chứa tag và ghi chú, gắn theo fingerprint. Ghi chú nào có dạng private key sẽ bị từ chối.

## Cấu trúc thư mục

```
src/core      logic thuần Node/TS, không import electron (dùng chung cho GUI và CLI)
  platform/     interface + bản cài đặt Windows (ACL, service agent, đường dẫn)
src/main      main process của Electron: cửa sổ, hardening, IPC (+ validate đầu vào)
src/preload   contextBridge -> window.skm
src/renderer  React + Fluent UI v9, chữ hiển thị trong i18n/vi.json
src/cli       CLI skm (commander)
resources/askpass  helper SSH_ASKPASS
tests/unit, tests/e2e
docs/screenshots   ảnh chụp từ e2e
```

## Ảnh chụp màn hình

| | Sáng | Tối |
|---|---|---|
| Keys | ![](docs/screenshots/keys-light.png) | ![](docs/screenshots/keys-dark.png) |
| Keys: chưa có key | ![](docs/screenshots/keys-empty-light.png) | ![](docs/screenshots/keys-empty-dark.png) |
| Keys: quyền không an toàn | ![](docs/screenshots/keys-unsafe-light.png) | ![](docs/screenshots/keys-unsafe-dark.png) |
| Tạo key | ![](docs/screenshots/generate-light.png) | ![](docs/screenshots/generate-dark.png) |
| Tạo key: kết quả | ![](docs/screenshots/generate-result-light.png) | ![](docs/screenshots/generate-result-dark.png) |
| ssh-agent | ![](docs/screenshots/agent-light.png) | ![](docs/screenshots/agent-dark.png) |
| Config | ![](docs/screenshots/config-light.png) | ![](docs/screenshots/config-dark.png) |
| Config: diff trước khi ghi | ![](docs/screenshots/config-diff-light.png) | ![](docs/screenshots/config-diff-dark.png) |
| Config: tab Raw | ![](docs/screenshots/config-raw-light.png) | ![](docs/screenshots/config-raw-dark.png) |
| Config: mẫu dịch vụ | ![](docs/screenshots/config-preset-light.png) | ![](docs/screenshots/config-preset-dark.png) |
| Kiểm tra kết nối | ![](docs/screenshots/test-light.png) | ![](docs/screenshots/test-dark.png) |
| Cài đặt | ![](docs/screenshots/settings-light.png) | ![](docs/screenshots/settings-dark.png) |
| Cửa sổ nhỏ nhất, DPI 150% / 200% | ![](docs/screenshots/keys-min-150pct.png) | ![](docs/screenshots/keys-min-200pct.png) |

## Hạn chế đã biết

- Hiện chỉ hỗ trợ Windows. Phần phụ thuộc hệ điều hành đã nằm sau các interface `PlatformPaths`, `FilePermissionService`, `AgentService`, nên có thể bổ sung macOS/Linux sau.
- Trên Windows không phải tiếng Anh, `icacls` hiển thị tên nhóm hệ thống đã dịch, và username có dấu có thể bị sai mã hoá, khiến kết quả kiểm tra ACL không chính xác.
- Thông báo lỗi luôn là tiếng Việt; `en.json` mới dịch một phần.
- Bản exe để nguyên chế độ cho phép chạy như Node.js (`ELECTRON_RUN_AS_NODE`), vì helper nhập passphrase cần chế độ này.
