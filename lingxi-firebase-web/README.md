# ✳ 灵犀 · Firebase 免安装远程联机版

这是一份 **纯静态 HTML + CSS + JavaScript** 网页项目。玩家不用安装 Node.js、Python、程序或者客户端，直接用手机/电脑浏览器进入同一个网址即可跨城市联机。

**注意：交付的是完整源代码，不是已经上线的网站。** 由于每个人的 Firebase 项目不同，需要项目所有者 **首次在 Firebase 控制台进行配置**，并将静态网页发布到 GitHub Pages。设置完成后，玩家无需配置或安装。

## 游戏规则

- 房主创建 **双人或三人房间**，发送邀请码/链接。
- 玩家在每轮的 **20 秒**内，独立写下 **1～24 字**的词语，每个人一轮只能提交一次。
- 全部提交就立刻揭晓；如果计时结束，还有人没提交，则揭晓并将其标记为「超时未提交」。
- **只有 2/3 个人都提交、且词完全相同**，才算默契成功。词语会去除首尾空格；不忽略大小写、不合并繁体/简体。
- 没成功就由房主进入下一轮；成功后可再次开始新的一局。
- 玩家在揭晓前无法通过正常的 Firebase 数据读取权限看到其他人的词（不只是网页上隐藏）。
- 重新打开相同网页，默认会恢复当前浏览器的匿名登录身份和游戏席位（浏览器清除数据/无痕模式不保证恢复）。

## 1. 创建 Firebase 项目（只需做一次）

1. 打开 https://console.firebase.google.com/ 并登录 Google 账号。
2. 点击「添加项目 / Create a project」，建立项目，例如 `lingxi-game`。
3. 在项目总览中点击 **Web 应用图标 `</>`** 注册网页应用，应用昵称任意，暂时不需要开启 Firebase Hosting。
4. 控制台会给你一个 `firebaseConfig` 配置对象。复制相关字段，后面需要粘贴。

官方教程：https://firebase.google.com/docs/web/setup

## 2. 开启匿名登录

1. Firebase 控制台 → **Authentication（身份验证）** →「开始使用」。
2. 打开 **Sign-in method（登录方式）** → **Anonymous（匿名）** → 启用 → 保存。
3. 等 GitHub Pages 网址创建出来后，到 Authentication → Settings → Authorized domains（已获授权的网域），如果需要添加，将你的 **`用户名.github.io`** 添加进去（填写域名，不带 `https://` 和路径）。

玩家不会被要求输入邮箱或密码。身份由浏览器匿名创建。

官方教程：https://firebase.google.com/docs/auth/web/anonymous-auth

## 3. 创建 Realtime Database 并导入权限规则（非常重要）

1. Firebase 控制台 → **Build → Realtime Database** →「创建数据库」。
2. 选择合适区域（例如接近玩家的区域）。选择 **锁定模式 / Start in locked mode**，不要选择公开读写规则。
3. 创建后，在「**数据 / Data**」页面顶部找到数据库 URL，常见样式为：
   - `https://项目名-default-rtdb.firebaseio.com`
   - 或 `https://数据库名.区域.firebasedatabase.app`
4. 进入 Realtime Database → **规则 / Rules**，打开本项目的 **`database.rules.json`**，将其中**全部内容**复制粘贴到规则编辑器，然后点击「发布 / Publish」。

**不能跳过规则文件！** 游戏需要它来限制只有房主能开局、每位玩家仅能提交自己的答案、以及超时后才可以公开答案。请勿用 `.read: true` / `.write: true` 作为最终规则。

官方文档：https://firebase.google.com/docs/database/security

## 4. 填写 `firebase-config.js`

用记事本打开项目根目录 `firebase-config.js`：

```js
export const firebaseConfig = {
  apiKey: "这里填 Firebase 提供的 apiKey",
  authDomain: "你的项目.firebaseapp.com",
  databaseURL: "这里填第3步复制的 Realtime Database URL",
  projectId: "你的项目ID",
  appId: "这里填 Firebase 提供的 appId"
};
```

五个字段都要换成真实值，尤其是 `databaseURL`。网页中公开的 Firebase Web 配置不是管理密钥；安全依赖于数据库规则。**不要**把 Firebase 服务账号 JSON、管理私钥、Google 账户凭据放进网站仓库。

## 5. 发布到 GitHub Pages（不需要命令行）

1. 打开 https://github.com/ ，登录 GitHub，创建一个 **Public（公开）** 仓库，例如 `lingxi`。
2. 进入仓库页面 → Add file → Upload files。
3. 上传 **ZIP 解压后文件夹里面的所有网页文件**，确保 `index.html` 和 `app.js` 在仓库根目录（不是再套一个文件夹）。
4. 进入仓库 **Settings → Pages** → Source 选择 **Deploy from a branch** → Branch 选择 `main`、目录选择 `/(root)` → Save。
5. 等 GitHub Pages 部署完成（通常需要一点时间），即可访问：

   `https://你的GitHub用户名.github.io/lingxi/`

6. 如果匿名登录出现 `auth/unauthorized-domain`，参照第 2 步添加你的 Pages 域名。
7. 打开网站 → 填昵称 → 创建房间 → 复制链接给朋友。

朋友可以在手机或电脑直接点开网址，**不用 GitHub 或 Firebase 账号，也不用下载安装**。

官方 Pages 指南：https://docs.github.com/pages/getting-started-with-github-pages/creating-a-github-pages-site

### 为什么不建议直接双击 `index.html`？

这个版本采用浏览器 ES Modules 和 Firebase 身份验证，直接使用 `file://` 打开网页可能遇到模块跨域/CORS 和身份验证限制。**把它放到 GitHub Pages（HTTPS）以后，就不需要本地服务器。**

## 常见问题

**显示「只需配置一次 Firebase」：** `firebase-config.js` 中还有 `YOUR_...` 或 `PASTE_...` 占位符，先填完整。

**提示 `auth/operation-not-allowed`：** 没有启用 Firebase 的匿名登录。

**提示 `PERMISSION_DENIED`：** 未发布 `database.rules.json`、使用了错误的数据库 URL，或者玩家操作不符合当前回合规则。

**别人打不开邀请链接：** 请检查网站是公开的 GitHub Pages HTTPS 地址，不是 `file:///...` 或 `localhost`。

**手机时间不同步？** 游戏由 Firebase 服务器写入本轮开始时间，用 `/.info/serverTimeOffset` 校正各个玩家显示的倒计时；网络延迟仍可能造成毫秒级偏差。提交和揭晓会由 Firebase 服务器规则按 20 秒限制执行。

**全员都离线时是否会准时自动揭晓？** 本版本没有常驻服务器或者云函数。只要**至少有一位玩家在线**，到点就会发起揭晓。若所有人同时断线，等任一人恢复在线后会自动推进。

**游戏数据能保留多久？** Firebase 会保存未解散的房间和历史数据；房主点击「解散房间」时删除该房间。当前版本未做自动清理、排行榜或大规模公开运营防滥用限制。

**Firebase 会收费吗？** 是否可在免费额度内使用，要视你的使用量和 Firebase 当前计划限制而定。请在 Firebase 控制台查看用量与计费信息。

## 项目文件

```text
lingxi-firebase-web/
├── index.html            网页入口
├── style.css             游戏样式 / 移动端适配
├── app.js                房间、输入、揭晓和 Firebase 同步
├── logic.mjs             无依赖游戏规则
├── firebase-config.js    需要首次填写的配置
├── database.rules.json   数据库安全规则（一定要发布）
├── favicon.svg           图标
├── .nojekyll             GitHub Pages 静态资源兼容
├── README.md             本文件
└── tests/logic.test.mjs  开发者可选的逻辑测试
```

`tests/` 只供开发者测试，玩家完全用不到。若你碰巧安装了 Node.js，可运行 `node --test tests/logic.test.mjs`；**这不是启动游戏的必要步骤**。

### 设计和隐私说明

- 项目使用 Firebase Authentication 的匿名身份及 Firebase Realtime Database 数据规则。若有人得知房间码，可看到大厅昵称；当前不包含密码房间、反刷屏或复杂的恶意玩家防护。
- 任何人都不应该把真实姓名、手机号、住址、秘密、密码当作游戏答案。
- Firebase 的浏览器配置是可公开信息，但始终要使用最小权限数据库规则。
- 逻辑测试已覆盖人数、20 秒截止时间、未提交超时和匹配判定。实际 Firebase 跨设备联机需要你完成上述设置后用两台设备自行试验；在没有你的 Firebase 项目时无法进行真实云端的端到端测试。
