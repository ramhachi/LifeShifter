# Timetracker 通信契約

確認日: 2026-08-17

## 根拠

- 公式サイト: <https://timetracker.live/>
- 公式 Mac 紹介: <https://timetracker.live/macos>
- 公式 Web クライアントが配信する JavaScript bundle の実装
- API server の unauthenticated response と `OPTIONS` response
- ログイン済み `/track` 画面で Activity tiles と current 未選択状態を確認

認証情報やユーザーデータは採取していない。以下は公開クライアントが実際に呼び出す契約であり、推測したパスではない。

## 共通

```text
Base URL: https://api.timetracker.live/api/
Authorization: Bearer <access token>
Content-Type: application/json
X-Client-Type: macos
X-Client-Version: 2.3.1
Timeout used by official client: 10 seconds
```

API は未認証時に HTTP 401 と `WWW-Authenticate: Bearer realm="api"` を返す。

## MVP で使う操作

### Google login（MVPで使用）

LifeShifter は `WKWebView` で公式 `https://timetracker.live/signin` を開く。Google Identity Services のポップアップも別 `WKWebView` として開き、公式ページに認証結果を返す。

認証完了後、現在ページの scheme と host が正確に `https://timetracker.live` である場合に限り、同一originの `localStorage` から `access_token` と `refresh_token` を取得し、Application Support の権限600ファイルへ保存する。Googleのcredential、ChromeのCookie、ChromeのlocalStorageは読まない。未署名MVPの更新時に承認待ちを繰り返さないため、Keychainは使用しない。

この方式は公式Webクライアントの現行実装に依存する。公式クライアントのtoken保存方式が変更された場合は再検証が必要。

### Email login（確認済み・MVPでは未使用）

```http
POST auth/login/

{"email":"...","password":"..."}
```

公式クライアントは `response.tokens.access` と `response.tokens.refresh` を保存する。

### Refresh

```http
POST token/refresh/

{"refresh":"..."}
```

### Activities

```http
GET activities/
```

MVP が読むフィールドは `id`, `name`, `icon`, `icon_color`, `parent_id`, `trackable` のみ。操作ボタンは `trackable == true` のActivityだけに限定する。

### Current entry

```http
GET time-tracking/current/
```

公式クライアントが使うフィールドは `id`, `activity_id`, `activity_name`, `activity_icon`, `activity_icon_color`, `start_time`, `end_time`, `is_active`。

実アカウントで未記録状態を確認したところ、HTTP成功かつ空bodyが返った。LifeShifterはこの場合だけJSONの `null` と同等に扱う。

### Switch

```http
POST time-tracking/switch/

{"activity_id": 123}
```

公式クライアントは `response.new_entry` を新しい current entry として使う。

Swift propertyの `activityID` は明示的なCodingKeyで `activity_id` へencodeする。実APIでは誤って `activityID` を送るとHTTP 400と `activity_id: This field is required.` が返る。

## 今回使わない確認済み操作

- `POST time-tracking/start/`
- `POST time-tracking/stop/`
- `GET time-tracking/entries/`
- `POST time-tracking/sync-offline/`
- `wss://api.timetracker.live/ws/time-tracking/?token=<access token>`

WebSocket と offline replay は MVP に入れない。30秒ポーリングで実用上の問題が出た場合だけ再評価する。

## 未確認

- 実アカウントでの response 全体
- 過去 timestamp を伴う offline replay の正確な schema
- 独自OAuth clientとcallback URLを使う第三者Macクライアント向けの正式フロー
- undocumented API の互換性保証

Chromeのtoken、Cookie、localStorageは読み取っていない。実アカウントのAPI検証はLifeShifter内の公式Timetracker画面でGoogleログインした後に行う。
