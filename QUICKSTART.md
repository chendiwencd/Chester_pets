# 🚀 快速开始

## 启动步骤

### 1. 启动 Backend（必需）

```bash
cd F:\Project\hbb\backend
python -m uvicorn app.main:app --reload
```

后端将运行在：`http://127.0.0.1:5000`

### 2. 启动 Desktop Shell

```bash
cd F:\Project\hbb\client_pc\desktop-shell
npm run dev
```

前端将运行在：`http://localhost:5173`

### 3. 启用在线模式并登录

1. 打开桌面宠物应用
2. 右键点击宠物 → 选择"控制面板"
3. 点击左侧"设置"
4. 打开"在线模式"开关
5. 点击左侧"个人"
6. 注册新账号或登录

## 🧪 测试工具

访问测试页面进行快速测试：
```
http://localhost:5173/auth-test.html
```

功能包括：
- ✅ 在线模式切换
- ✅ 注册测试
- ✅ 登录测试
- ✅ 登出测试
- ✅ Token 刷新测试
- ✅ 后端连接测试

## 📖 查看 API 文档

Backend API 文档：
- Swagger UI: http://127.0.0.1:5000/docs
- ReDoc: http://127.0.0.1:5000/redoc

## 💡 快速测试账号

使用测试工具或控制面板注册：

```
邮箱: test@example.com
用户名: testuser
密码: password123
```

登录：
```
账号: testuser (或 test@example.com)
密码: password123
```

## ⚙️ 配置

### 修改后端地址

编辑 `src/api/authClient.ts`:

```typescript
export const apiClient = new ApiClient("http://your-backend-url:port");
```

### 本地存储数据

所有数据存储在浏览器 localStorage：
- `user` - 用户信息
- `access_token` - 访问令牌
- `refresh_token` - 刷新令牌
- `session_id` - 会话 ID
- `online_mode` - 在线模式开关

清除数据：浏览器控制台执行
```javascript
localStorage.clear()
```

## 🔍 调试

### 查看认证状态

浏览器控制台执行：
```javascript
// 查看当前状态
window.authStore?.getState()

// 监听状态变化
window.authStore?.subscribe(state => console.log('状态变化:', state))
```

### 查看 Network 请求

1. 打开浏览器开发者工具 (F12)
2. 切换到 Network 标签
3. 执行登录/注册操作
4. 查看请求详情（URL、Headers、Response）

## 📂 重要文件

```
desktop-shell/
├── src/
│   ├── api/
│   │   ├── types.ts              # 类型定义
│   │   ├── authClient.ts         # API 客户端
│   │   └── examples.ts           # 代码示例
│   ├── authStore.ts              # 状态管理
│   └── controlPanelView.ts       # UI 界面
├── auth-test.html                # 测试工具
├── AUTH_INTEGRATION.md           # 详细文档
└── SUMMARY.md                    # 完成总结
```

## 🐛 常见问题

### 1. 后端连接失败

**错误**: `fetch failed` 或 `Connection refused`

**解决**:
- 确认后端已启动：`http://127.0.0.1:5000/docs` 能访问
- 检查端口是否被占用
- 查看后端日志是否有错误

### 2. 登录后刷新页面丢失状态

**原因**: localStorage 数据丢失

**解决**:
- 检查浏览器是否启用了隐私模式
- 确认没有手动清除 localStorage
- 查看浏览器控制台是否有错误

### 3. CORS 跨域错误

**错误**: `CORS policy` 相关错误

**解决**: 在 backend 的 `app/main.py` 中配置 CORS：
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 4. Token 过期

**症状**: 一段时间后请求返回 401

**临时方案**: 重新登录

**正式方案**: 实现自动刷新（待开发）

## 📚 更多文档

- [AUTH_INTEGRATION.md](./AUTH_INTEGRATION.md) - 完整集成文档
- [SUMMARY.md](./SUMMARY.md) - 功能总结
- [src/api/examples.ts](./src/api/examples.ts) - 代码示例

## 🎯 下一步

- [ ] 测试注册功能
- [ ] 测试登录功能
- [ ] 测试在线/离线模式切换
- [ ] 查看用户信息显示
- [ ] 测试登出功能

祝使用愉快！🎉
