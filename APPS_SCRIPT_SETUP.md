# Google Apps Script Login Check

File script đã tạo sẵn:

- [apps-script/Code.gs](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/apps-script/Code.gs)

## Sheet nên có các cột

Tối thiểu:

- `username`
- `password`

Khuyến nghị thêm:

- `status`
- `displayName`
- `role`
- `boardKey`
- `lastLoginAt`
- `lastLoginStatus`
- `lastDevice`

## Password hỗ trợ

- Plain text: `123456`
- Hoặc hash: `sha256:<hex>`

## Cách deploy

1. Mở [Google Apps Script](https://script.new/)
2. Xóa code mặc định
3. Dán toàn bộ nội dung từ [apps-script/Code.gs](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/apps-script/Code.gs)
4. `Project Settings`:
   - timezone nên để `Asia/Bangkok`
5. `Deploy` -> `New deployment`
6. Chọn `Web app`
7. `Execute as`: `Me`
8. `Who has access`: `Anyone with the link`
9. `Deploy`
10. Copy `Web app URL`

## Nối vào web hiện tại

Mở [config.js](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/config.js:1) và điền:

```js
window.POSINGBOARD_CONFIG = {
  apiBase: "https://possingboard.chipkenzo6789.workers.dev/api",
  appsScriptUrl: "https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec",
  boardKey: "boards/shared-board.json",
  cloudinary: {
    cloudName: "dpjgr2bqs",
    uploadPreset: "POSSING",
    folder: "Possing board",
  },
};
```

Sau đó reload web.

## Nhớ mật khẩu

- Web hiện tại đã có checkbox `Nhớ mật khẩu và tự động đăng nhập`
- Khi bật, app sẽ lưu `username/password` ở máy đang dùng và lần sau tự gọi Apps Script để login lại
- Nếu tắt hoặc bấm `Đăng xuất`, dữ liệu nhớ mật khẩu sẽ bị xóa

## API dùng để check login

`POST <web-app-url>`

Body JSON:

```json
{
  "action": "login",
  "username": "demo",
  "password": "123456",
  "device": "mobile-1"
}
```

Kết quả đúng:

```json
{
  "ok": true,
  "user": {
    "username": "demo",
    "displayName": "Demo User",
    "role": "editor",
    "boardKey": "boards/shared-board.json"
  }
}
```

Kết quả sai:

```json
{
  "ok": false,
  "error": "Tài khoản hoặc mật khẩu không đúng."
}
```

## Ghi chú

- Script đang đọc đúng spreadsheet:
  `1ZCBdiw3AJb3a6BRUgYJL5ykJJ39bu8lBOc1GC6XOXa0`
- Script ưu tiên tab có `gid = 0`
- Nếu có cột `lastLoginAt`, `lastLoginStatus`, `lastDevice` thì script sẽ tự ghi lại lần đăng nhập
- Để app web hiện tại gọi script này an toàn hơn, bước tiếp theo nên là:
  - frontend gọi `Worker`
  - `Worker` gọi `Apps Script`
  - không gọi trực tiếp Apps Script từ browser
