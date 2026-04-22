const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./taskflow.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT, assignee TEXT, description TEXT, subtasks TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS team (id INTEGER PRIMARY KEY, users_count INTEGER, plan TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, action TEXT)`);
    
    db.get("SELECT count(*) as count FROM team", (err, row) => {
        if(row.count === 0) db.run("INSERT INTO team (id, users_count, plan) VALUES (1, 8, 'free')");
    });
});

function logAndBroadcast(actionText) {
    db.run("INSERT INTO logs (action) VALUES (?)", [actionText]);
    io.emit('system_update', actionText);
}

io.on('connection', (socket) => {
    console.log('有新用户连接入系统: ' + socket.id);
});

/* --- 1. 任务管理接口 --- */
app.get('/api/tasks', (req, res) => { db.all("SELECT * FROM tasks", [], (err, rows) => res.json(rows)); });

app.post('/api/tasks', (req, res) => {
    const { title, assignee, operator } = req.body;
    db.run("INSERT INTO tasks (title, status, assignee) VALUES (?, ?, ?)", [title, 'todo', assignee || '待分配'], function(err) { 
        logAndBroadcast(`${operator || '某人'} 新建了任务: [${title}] 并分配给 ${assignee || '待分配'}`);
        res.json({ id: this.lastID }); 
    });
});

app.put('/api/tasks/:id', (req, res) => {
    const { status, operator, taskTitle } = req.body;
    const statusMap = { 'todo': '待办', 'inprogress': '进行中', 'done': '已完成' };
    db.run("UPDATE tasks SET status = ? WHERE id = ?", [status, req.params.id], () => {
        logAndBroadcast(`${operator || '某人'} 将任务 [${taskTitle || 'TASK-'+req.params.id}] 移动到了 <${statusMap[status]}>`);
        res.json({ success: true });
    });
});

app.delete('/api/tasks/:id', (req, res) => {
    db.run("DELETE FROM tasks WHERE id = ?", [req.params.id], () => {
        logAndBroadcast(`项目经理 删除了任务 TASK-${req.params.id}`);
        res.json({ success: true });
    });
});

/* --- 2. 日志接口 --- */
app.get('/api/logs', (req, res) => {
    db.all("SELECT datetime(time, 'localtime') as local_time, action FROM logs ORDER BY id DESC LIMIT 20", [], (err, rows) => res.json(rows));
});

/* --- 3. 团队计费与支付接口 (MVP 赞赏码方案) --- */
app.get('/api/team', (req, res) => { db.get("SELECT * FROM team WHERE id = 1", (err, row) => res.json(row)); });

app.post('/api/team/invite', (req, res) => {
    db.get("SELECT * FROM team WHERE id = 1", (err, row) => {
        if (row.plan === 'free' && row.users_count >= 10) return res.status(403).json({ error: 'UPGRADE_REQUIRED' });
        db.run("UPDATE team SET users_count = users_count + 1 WHERE id = 1", () => res.json({ success: true }));
    });
});

app.post('/api/team/submit_payment', (req, res) => {
    const { reference, user } = req.body;
    logAndBroadcast(`💰 【财务通知】用户 [${user}] 提交了付款凭证: ${reference}，等待审核。`);
    res.json({ success: true });
});

app.post('/api/team/upgrade', (req, res) => { 
    db.run("UPDATE team SET plan = 'pro' WHERE id = 1", () => {
        logAndBroadcast(`🎉 【系统广播】管理员已确认收款！团队成功升级为 👑 专业版，人数限制已解除！`);
        res.json({ success: true }); 
    }); 
});

server.listen(3000, () => console.log('TaskFlow V5.0 (MVP版) 已启动'));