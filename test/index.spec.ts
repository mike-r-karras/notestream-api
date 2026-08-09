import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import worker from "../src/index";

describe("notestream-api Auth & User tests", () => {
	beforeAll(async () => {
		// Initialize the test D1 database schema
		await env.DB.exec("DROP TABLE IF EXISTS sessions;");
		await env.DB.exec("DROP TABLE IF EXISTS user_scores;");
		await env.DB.exec("DROP TABLE IF EXISTS user_score_folders;");
		await env.DB.exec("DROP TABLE IF EXISTS users;");

		await env.DB.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE, email TEXT NOT NULL COLLATE NOCASE, password_hash TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'regular' CHECK (type IN ('admin', 'regular')), created_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), modified_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), modified_by INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')), avatar BLOB, avatar_content_type TEXT, CONSTRAINT uq_users_username UNIQUE (username), CONSTRAINT uq_users_email UNIQUE (email));");

		await env.DB.exec("CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_datetime TEXT NOT NULL, created_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);");
	});

	it("creates a new user and logs in", async () => {
		const ctx = createExecutionContext();

		// 1. Create user
		const createReq = new Request("http://localhost/api/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: "testuser",
				email: "testuser@example.com",
				passwordHash: "myhashedpassword123",
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(createRes.status).toBe(201);
		const createUserBody = (await createRes.json()) as any;
		expect(createUserBody.data.username).toBe("testuser");
		expect(createUserBody.data.email).toBe("testuser@example.com");
		expect(createUserBody.data.hasAvatar).toBe(false);

		// 2. Log in (invalid password)
		const ctx2 = createExecutionContext();
		const loginFailReq = new Request("http://localhost/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: "testuser",
				passwordHash: "wrong_password",
			}),
		});
		const loginFailRes = await worker.fetch(loginFailReq, env, ctx2);
		await waitOnExecutionContext(ctx2);
		expect(loginFailRes.status).toBe(401);

		// 3. Log in (successful)
		const ctx3 = createExecutionContext();
		const loginReq = new Request("http://localhost/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: "testuser",
				passwordHash: "myhashedpassword123",
			}),
		});
		const loginRes = await worker.fetch(loginReq, env, ctx3);
		await waitOnExecutionContext(ctx3);
		expect(loginRes.status).toBe(200);

		const loginBody = (await loginRes.json()) as any;
		expect(loginBody.data.token).toBeDefined();
		expect(loginBody.data.user.username).toBe("testuser");

		const token = loginBody.data.token;

		// 4. Verify session
		const ctx4 = createExecutionContext();
		const sessionReq = new Request("http://localhost/api/auth/session", {
			method: "GET",
			headers: {
				"Authorization": `Bearer ${token}`,
			},
		});
		const sessionRes = await worker.fetch(sessionReq, env, ctx4);
		await waitOnExecutionContext(ctx4);
		expect(sessionRes.status).toBe(200);
		const sessionBody = (await sessionRes.json()) as any;
		expect(sessionBody.data.user.username).toBe("testuser");

		// 5. Log out
		const ctx5 = createExecutionContext();
		const logoutReq = new Request("http://localhost/api/auth/logout", {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
			},
		});
		const logoutRes = await worker.fetch(logoutReq, env, ctx5);
		await waitOnExecutionContext(ctx5);
		expect(logoutRes.status).toBe(204);

		// 6. Verify session is now invalid
		const ctx6 = createExecutionContext();
		const sessionCheckReq = new Request("http://localhost/api/auth/session", {
			method: "GET",
			headers: {
				"Authorization": `Bearer ${token}`,
			},
		});
		const sessionCheckRes = await worker.fetch(sessionCheckReq, env, ctx6);
		await waitOnExecutionContext(ctx6);
		expect(sessionCheckRes.status).toBe(401);
	});
});
