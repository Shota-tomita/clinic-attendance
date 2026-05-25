# クリニック勤怠管理システム — セットアップ手順書

## システム概要

| ロール | できること |
|--------|-----------|
| **院長（admin）** | 全機能・スタッフ管理・シフトパターン作成・有給審査 |
| **リーダー（leader）** | 自部署スタッフのシフト入力・有給審査・勤怠閲覧 |
| **スタッフ（staff）** | 出退勤打刻・自分の履歴閲覧・有給申請 |

---

## STEP 1: Supabase セットアップ（約10分）

### 1-1. アカウント作成
1. https://supabase.com にアクセス
2. 「Start your project」→ GitHubアカウントでサインアップ
3. 「New project」をクリック
4. 設定:
   - **Project name**: `clinic-attendance`（任意）
   - **Database Password**: 強いパスワードを設定・メモしておく
   - **Region**: `Northeast Asia (Tokyo)` を選択
5. 「Create new project」→ 約2分待つ

### 1-2. データベース構築
1. 左メニューの「SQL Editor」をクリック
2. 「New query」をクリック
3. `supabase/migrations/001_initial_schema.sql` の中身を全コピー
4. エディタに貼り付けて「Run」（▶ボタン）
5. 「Success」と表示されれば完了 ✅

### 1-3. 接続キーの取得
1. 左メニューの「Settings」→「API」
2. 以下をコピーしてメモ:
   - **Project URL**: `https://xxxxxx.supabase.co`
   - **anon (public) key**: `eyJh...` から始まる長い文字列

---

## STEP 2: コードの準備（約5分）

### 2-1. 環境変数ファイルの作成
`clinic-attendance` フォルダ内の `.env.local.example` をコピーして `.env.local` にリネームし、以下を編集:

```
NEXT_PUBLIC_SUPABASE_URL=https://あなたのプロジェクトID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=あなたのanon_key
```

### 2-2. GitHubへのアップロード
1. https://github.com にサインアップ（未登録の場合）
2. 「New repository」→ 名前: `clinic-attendance`、Private を選択
3. ローカルまたはGitHub Desktopでアップロード

> ⚠️ `.env.local` は `.gitignore` に含まれているため、自動的にGitHubにはアップされません（安全）

---

## STEP 3: Vercel デプロイ（約5分）

### 3-1. Vercelアカウント作成
1. https://vercel.com にアクセス
2. 「Start Deploying」→ GitHubでサインアップ

### 3-2. プロジェクトインポート
1. 「Add New...」→「Project」
2. GitHubのリポジトリ `clinic-attendance` を選択 → 「Import」

### 3-3. 環境変数を設定
「Environment Variables」セクションに以下を追加:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJh...` |

### 3-4. デプロイ
「Deploy」をクリック → 約2〜3分でURL発行 ✅

---

## STEP 4: 初期設定（院長アカウント作成）

### 4-1. Supabaseから院長を登録
1. Supabase ダッシュボード →「Authentication」→「Users」
2. 「Invite user」をクリック
3. 院長のメールアドレスを入力 →「Send invite」
4. 届いたメールからパスワードを設定してログイン

### 4-2. 院長ロールを設定（SQL Editor）
```sql
UPDATE profiles
SET role = 'admin'
WHERE email = '院長のメールアドレス';
```

### 4-3. 使い始め
1. Vercelで発行されたURLにアクセス
2. 院長でログイン
3. 「部署管理」で部署を追加（または初期データ3部署がある）
4. 「スタッフ管理」→「スタッフ招待」でメンバーを招待
5. 「シフトパターン」で早番・遅番などを作成
6. 「シフト管理」でカレンダーからシフトを割り当て

---

## 操作マニュアル

### 🗂️ シフトパターン管理（院長のみ）
- パターン名・開始/終了時間・休憩・カレンダー表示色を設定
- 例: 早番（8:00-17:00）、日勤（9:00-18:00）、遅番（12:00-21:00）
- 作成後はシフト管理カレンダーで選択可能になる

### 📅 シフト管理
- **院長**: 全スタッフのシフトを設定可能
- **リーダー**: 自部署スタッフのシフトのみ設定可能
- **スタッフ**: 自分のシフトを閲覧のみ
- カレンダーのセルをクリック → パターンを選択 → 保存

### ⏱️ 出退勤打刻（スタッフ）
- 「出勤」ボタン → 出勤時刻を記録
- 「退勤」ボタン → 退勤時刻を記録
- 1日1回のみ（修正が必要な場合は院長へ）

### 🌿 有給申請
- スタッフが申請 → リーダーまたは院長が承認/却下
- 承認されると有給残日数が自動で減算

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| ログインできない | Supabaseの「Authentication」でメール確認状況を確認 |
| データが表示されない | SupabaseのRLSポリシーが正しく適用されているか確認 |
| シフトを保存できない | ロール（リーダー/admin）が正しく設定されているか確認 |
| 環境変数エラー | Vercelの環境変数が正しく設定されているか確認 |

---

## 無料枠の制限（2025年時点）

| サービス | 無料枠 |
|---------|-------|
| Supabase | DB 500MB・月50万リクエスト |
| Vercel | 月100GB帯域・関数100GB-hours |

クリニック規模（〜50名程度）では無料枠で十分運用可能です。
