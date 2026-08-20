# Desktop Shell - 认证系统对接文档

## 概述

已完成 desktop-shell 与 backend 用户认证接口的对接，包括登录、注册、登出等功能。

## 新增文件

### 1. `src/api/types.ts`
定义了与 backend 接口对应的 TypeScript 类型：
- `UserRead`: 用户信息
- `AuthResponse`: 认证响应（包含用户、token、session）
- `AccountLoginRequest/AccountRegisterRequest`: 账号登录/注册请求
- `PhoneLoginRequest/PhoneCodeRequest`: 手机号登录/验证码请求
- `TokenPair`: access_token 和 refresh_token
- 其他辅助类型

### 2. `src/api/authClient.ts`
封装了 backend 认证接口的 HTTP 客户端：
- `accountRegister()`: 邮箱+用户名+密码注册
- `accountLogin()`: 用户名或邮箱+密码登录
- `sendPhoneCode()`: 发送手机验证码
- `phoneLogin()`: 手机号登录（验证码或密码）
- `refreshToken()`: 刷新 token
- `logout()`: 登出

默认后端地址：`http://127.0.0.1:8000`

### 3. `src/authStore.ts`
全局认证状态管理：
- 用户登录状态（`user`, `isLoggedIn`, `onlineMode`）
- 状态持久化到 localStorage
- Token 自动管理（access_token, refresh_token）
- 提供登录、注册、登出等方法
- 订阅模式通知 UI 更新

## 修改文件

### 1. `src/controlPanelView.ts`
更新了控制面板的个人和设置界面：

#### 个人页面
- **离线模式**：显示提示，引导用户启用在线模式
- **未登录**：显示登录/注册表单
  - 登录：输入账号（用户名或邮箱）+ 密码
  - 注册：输入邮箱 + 用户名 + 密码
  - 可切换登录/注册模式
- **已登录**：显示用户信息和退出登录按钮
  - 个人信息卡片显示：头像、用户名、邮箱、手机、VIP 状态

#### 设置页面
- **在线模式开关**（新增）：
  - 启用后可登录账号使用云端功能
  - 关闭则为离线模式
  - 状态持久化到 localStorage
- 原有的开机自启等设置保持不变

### 2. `src/backendClient.ts`
更新了 backend 客户端，增加在线/离线模式判断：
- `reportStatus()`: 在线模式且已登录时上报宠物状态
- `fetchPetConfig()`: 在线模式且已登录时获取配置
- 离线模式下仅本地 mock

### 3. `src/styles.css`
新增样式：
- `.control-panel-link-button`: 登录/注册切换按钮
- `.control-panel-vip-badge`: VIP 徽章样式（金色渐变）

## 使用说明

### 开发环境启动

1. 确保 backend 已启动：
```bash
cd F:/Project/hbb/backend
python -m uvicorn app.main:app --reload
```

2. 启动 desktop-shell：
```bash
cd F:/Project/hbb/client_pc/desktop-shell
npm run dev
```

3. 打开控制面板，进入"设置"页面，启用"在线模式"

4. 返回"个人"页面进行注册或登录

### 接口文档

可访问后端 API 文档：
- Swagger UI: http://127.0.0.1:8000/docs
- ReDoc: http://127.0.0.1:8000/redoc

### 数据持久化

以下数据存储在 localStorage：
- `user`: 用户信息（JSON）
- `access_token`: 访问令牌
- `refresh_token`: 刷新令牌
- `session_id`: 会话 ID
- `online_mode`: 在线模式开关（true/false）

## 功能特性

- ✅ 账号注册（邮箱 + 用户名 + 密码）
- ✅ 账号登录（用户名或邮箱 + 密码）
- ✅ 用户信息展示
- ✅ VIP 状态显示
- ✅ 登出功能
- ✅ 在线/离线模式切换
- ✅ Token 自动管理
- ✅ 错误处理和用户提示
- ⏸️ 手机号登录（接口已对接，UI 待实现）
- ⏸️ Token 自动刷新（逻辑已实现，需定时器触发）
- ⏸️ VIP 相关功能（暂不处理）

## 待完善

1. **Token 自动刷新**：当 access_token 过期时自动调用 refresh API
2. **手机号登录界面**：添加手机号+验证码登录选项
3. **密码修改**：添加修改密码功能
4. **错误重试**：网络请求失败时的重试机制
5. **请求拦截器**：统一处理 401 等错误状态码
6. **表单验证**：前端输入验证（邮箱格式、密码强度等）

## 注意事项

- 开发阶段使用明文存储 token，生产环境需考虑安全存储方案
- 目前未实现 token 过期自动刷新，需手动重新登录
- VIP 功能暂不实现，仅显示状态
- 在线模式开关影响所有后端交互行为
