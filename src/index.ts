export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
}

type UserType = "admin" | "regular";
type UserStatus = "active" | "suspended" | "deleted";
type ScoreStatus = "active" | "deleted";

interface UserRow {
  id: number;
  username: string;
  email: string;
  type: UserType;
  created_datetime: string;
  modified_datetime: string;
  modified_by: number | null;
  status: UserStatus;
  has_avatar: number;
}

interface FolderRow {
  id: number;
  user_id: number;
  folder_name: string;
  folder_parent: number | null;
  created_datetime: string;
  modified_datetime: string;
}

interface ScoreRow {
  id: number;
  user_id: number;
  folder_id: number | null;
  title: string;
  instrument: string | null;
  author: string | null;
  score_representation: string | null;
  created_datetime: string;
  modified_datetime: string;
  modified_by: number | null;
  status: ScoreStatus;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const USER_SELECT = `
  SELECT
    id,
    username,
    email,
    type,
    created_datetime,
    modified_datetime,
    modified_by,
    status,
    CASE WHEN avatar IS NULL THEN 0 ELSE 1 END AS has_avatar
  FROM users
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }), env);
      }

      const url = new URL(request.url);
      const path = normalizePath(url.pathname);
      const method = request.method.toUpperCase();

      let response: Response;

      if (method === "GET" && path === "/health") {
        response = json({
          status: "ok",
          service: "notestream-api",
          timestamp: new Date().toISOString(),
        });
      } else {
        response = await routeApi(request, env, method, path, url);
      }

      return withCors(response, env);
    } catch (error) {
      console.error(error);

      const response =
        error instanceof HttpError
          ? json(
              {
                error: error.message,
                details: error.details,
              },
              error.status,
            )
          : json({ error: "Internal server error" }, 500);

      return withCors(response, env);
    }
  },
} satisfies ExportedHandler<Env>;

async function routeApi(
  request: Request,
  env: Env,
  method: string,
  path: string,
  url: URL,
): Promise<Response> {
  if (method === "POST" && path === "/api/auth/login") {
    return login(request, env);
  }

  if (method === "POST" && path === "/api/auth/logout") {
    return logout(request, env);
  }

  if (method === "GET" && path === "/api/auth/session") {
    return getSession(request, env);
  }

  if (method === "GET" && path === "/api/users") {
    return listUsers(env, url);
  }

  if (method === "POST" && path === "/api/users") {
    return createUser(request, env);
  }

  let match = path.match(/^\/api\/users\/(\d+)$/);

  if (match) {
    const userId = parseId(match[1]);

    if (method === "GET") {
      return getUser(env, userId);
    }

    if (method === "PATCH") {
      return updateUser(request, env, userId);
    }

    if (method === "DELETE") {
      return deleteUser(request, env, userId);
    }
  }

  match = path.match(/^\/api\/users\/(\d+)\/avatar$/);

  if (match) {
    const userId = parseId(match[1]);

    if (method === "GET") {
      return getAvatar(env, userId);
    }

    if (method === "PUT") {
      return updateAvatar(request, env, userId);
    }

    if (method === "DELETE") {
      return deleteAvatar(env, userId);
    }
  }

  match = path.match(/^\/api\/users\/(\d+)\/folders$/);

  if (match) {
    const userId = parseId(match[1]);

    if (method === "GET") {
      return listFolders(env, userId, url);
    }

    if (method === "POST") {
      return createFolder(request, env, userId);
    }
  }

  match = path.match(/^\/api\/folders\/(\d+)$/);

  if (match) {
    const folderId = parseId(match[1]);

    if (method === "GET") {
      return getFolder(env, folderId);
    }

    if (method === "PATCH") {
      return updateFolder(request, env, folderId);
    }

    if (method === "DELETE") {
      return deleteFolder(env, folderId);
    }
  }

  match = path.match(/^\/api\/users\/(\d+)\/scores$/);

  if (match) {
    const userId = parseId(match[1]);

    if (method === "GET") {
      return listScores(env, userId, url);
    }

    if (method === "POST") {
      return createScore(request, env, userId);
    }
  }

  match = path.match(/^\/api\/users\/(\d+)\/scores\/(\d+)$/);

  if (match) {
    const userId = parseId(match[1]);
    const scoreId = parseId(match[2]);

    if (method === "GET") {
      return getScore(env, userId, scoreId);
    }

    if (method === "PATCH") {
      return updateScore(request, env, userId, scoreId);
    }

    if (method === "DELETE") {
      return deleteScore(request, env, userId, scoreId);
    }
  }

  throw new HttpError(404, "Route not found");
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

async function listUsers(env: Env, url: URL): Promise<Response> {
  const { limit, offset } = getPagination(url);

  const status = url.searchParams.get("status");
  const query = url.searchParams.get("q")?.trim();

  if (status && !isUserStatus(status)) {
    throw new HttpError(400, "Invalid user status");
  }

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (status) {
    conditions.push("status = ?");
    values.push(status);
  }

  if (query) {
    conditions.push("(username LIKE ? OR email LIKE ?)");
    values.push(`%${query}%`, `%${query}%`);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const statement = env.DB.prepare(`
    ${USER_SELECT}
    ${where}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).bind(...values, limit, offset);

  const result = await statement.all<UserRow>();

  return json({
    data: result.results.map(serializeUser),
    pagination: {
      limit,
      offset,
      count: result.results.length,
    },
  });
}

async function createUser(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<{
    username?: string;
    email?: string;
    passwordHash?: string;
    type?: UserType;
    status?: UserStatus;
    modifiedBy?: number | null;
  }>(request);

  const username = requireText(body.username, "username", 100);
  const email = normalizeEmail(
    requireText(body.email, "email", 320),
  );
  const passwordHash = requireText(
    body.passwordHash,
    "passwordHash",
    512,
  );

  const type = body.type ?? "regular";
  const status = body.status ?? "active";

  if (!isUserType(type)) {
    throw new HttpError(400, "type must be admin or regular");
  }

  if (!isUserStatus(status)) {
    throw new HttpError(400, "Invalid user status");
  }

  try {
    const result = await env.DB.prepare(`
      INSERT INTO users (
        username,
        email,
        password_hash,
        type,
        modified_by,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `)
      .bind(
        username,
        email,
        passwordHash,
        type,
        body.modifiedBy ?? null,
        status,
      )
      .first<{ id: number }>();

    if (!result) {
      throw new HttpError(500, "User was not created");
    }

    return json(
      {
        data: await findUser(env, result.id),
      },
      201,
    );
  } catch (error) {
    throwD1ConstraintError(error, "Username or email already exists");
  }
}

async function getUser(env: Env, userId: number): Promise<Response> {
  return json({
    data: await findUser(env, userId),
  });
}

async function updateUser(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  await assertUserExists(env, userId);

  const body = await readJson<{
    username?: string;
    email?: string;
    passwordHash?: string;
    type?: UserType;
    status?: UserStatus;
    modifiedBy?: number | null;
  }>(request);

  const assignments: string[] = [];
  const values: unknown[] = [];

  if (body.username !== undefined) {
    assignments.push("username = ?");
    values.push(requireText(body.username, "username", 100));
  }

  if (body.email !== undefined) {
    assignments.push("email = ?");
    values.push(
      normalizeEmail(requireText(body.email, "email", 320)),
    );
  }

  if (body.passwordHash !== undefined) {
    assignments.push("password_hash = ?");
    values.push(
      requireText(body.passwordHash, "passwordHash", 512),
    );
  }

  if (body.type !== undefined) {
    if (!isUserType(body.type)) {
      throw new HttpError(400, "type must be admin or regular");
    }

    assignments.push("type = ?");
    values.push(body.type);
  }

  if (body.status !== undefined) {
    if (!isUserStatus(body.status)) {
      throw new HttpError(400, "Invalid user status");
    }

    assignments.push("status = ?");
    values.push(body.status);
  }

  if (body.modifiedBy !== undefined) {
    assignments.push("modified_by = ?");
    values.push(body.modifiedBy);
  }

  if (assignments.length === 0) {
    throw new HttpError(400, "No supported fields were provided");
  }

  assignments.push(
    "modified_datetime = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  );

  try {
    await env.DB.prepare(`
      UPDATE users
      SET ${assignments.join(", ")}
      WHERE id = ?
    `)
      .bind(...values, userId)
      .run();
  } catch (error) {
    throwD1ConstraintError(error, "Username or email already exists");
  }

  return json({
    data: await findUser(env, userId),
  });
}

async function deleteUser(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  await assertUserExists(env, userId);

  const body = await readOptionalJson<{
    modifiedBy?: number | null;
    permanent?: boolean;
  }>(request);

  if (body.permanent === true) {
    await env.DB.prepare("DELETE FROM users WHERE id = ?")
      .bind(userId)
      .run();

    return new Response(null, { status: 204 });
  }

  await env.DB.prepare(`
    UPDATE users
    SET
      status = 'deleted',
      modified_by = ?,
      modified_datetime = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `)
    .bind(body.modifiedBy ?? null, userId)
    .run();

  return json({
    data: await findUser(env, userId),
  });
}

async function findUser(
  env: Env,
  userId: number,
): Promise<ReturnType<typeof serializeUser>> {
  const user = await env.DB.prepare(`
    ${USER_SELECT}
    WHERE id = ?
  `)
    .bind(userId)
    .first<UserRow>();

  if (!user) {
    throw new HttpError(404, "User not found");
  }

  return serializeUser(user);
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

async function updateAvatar(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  await assertUserExists(env, userId);

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "image/png") {
    throw new HttpError(415, "Avatar must be a PNG image");
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );

  const maxAvatarBytes = 250 * 1024;

  if (contentLength > maxAvatarBytes) {
    throw new HttpError(413, "Avatar must not exceed 250 KB");
  }

  const avatar = await request.arrayBuffer();

  if (avatar.byteLength === 0) {
    throw new HttpError(400, "Avatar body is empty");
  }

  if (avatar.byteLength > maxAvatarBytes) {
    throw new HttpError(413, "Avatar must not exceed 250 KB");
  }

  if (!isPng(avatar)) {
    throw new HttpError(400, "File does not have a valid PNG signature");
  }

  await env.DB.prepare(`
    UPDATE users
    SET
      avatar = ?,
      avatar_content_type = 'image/png',
      modified_datetime = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `)
    .bind(avatar, userId)
    .run();

  return json({
    data: {
      userId,
      contentType: "image/png",
      size: avatar.byteLength,
      avatarUrl: `/api/users/${userId}/avatar`,
    },
  });
}

async function getAvatar(env: Env, userId: number): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT avatar, avatar_content_type
    FROM users
    WHERE id = ?
  `)
    .bind(userId)
    .first<{
      avatar: number[] | null;
      avatar_content_type: string | null;
    }>();

  if (!result) {
    throw new HttpError(404, "User not found");
  }

  if (!result.avatar) {
    throw new HttpError(404, "User does not have an avatar");
  }

  /*
   * D1 returns BLOB values as a number array. Convert it back into
   * a Uint8Array before returning it.
   */
  const bytes = new Uint8Array(result.avatar);

  return new Response(bytes, {
    headers: {
      "Content-Type": result.avatar_content_type ?? "image/png",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function deleteAvatar(
  env: Env,
  userId: number,
): Promise<Response> {
  await assertUserExists(env, userId);

  await env.DB.prepare(`
    UPDATE users
    SET
      avatar = NULL,
      avatar_content_type = NULL,
      modified_datetime = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `)
    .bind(userId)
    .run();

  return new Response(null, { status: 204 });
}

/* -------------------------------------------------------------------------- */
/* Folders                                                                    */
/* -------------------------------------------------------------------------- */

async function listFolders(
  env: Env,
  userId: number,
  url: URL,
): Promise<Response> {
  await assertUserExists(env, userId);

  const parentParameter = url.searchParams.get("parent");
  const values: unknown[] = [userId];

  let parentCondition = "";

  if (parentParameter === "root") {
    parentCondition = "AND folder_parent IS NULL";
  } else if (parentParameter !== null) {
    parentCondition = "AND folder_parent = ?";
    values.push(parseId(parentParameter));
  }

  const result = await env.DB.prepare(`
    SELECT
      id,
      user_id,
      folder_name,
      folder_parent,
      created_datetime,
      modified_datetime
    FROM user_score_folders
    WHERE user_id = ?
      ${parentCondition}
    ORDER BY folder_name COLLATE NOCASE
  `)
    .bind(...values)
    .all<FolderRow>();

  return json({
    data: result.results,
  });
}

async function createFolder(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  await assertActiveUser(env, userId);

  const body = await readJson<{
    folderName?: string;
    folderParent?: number | null;
  }>(request);

  const folderName = requireText(
    body.folderName,
    "folderName",
    200,
  );

  if (body.folderParent !== undefined && body.folderParent !== null) {
    await assertFolderBelongsToUser(
      env,
      body.folderParent,
      userId,
    );
  }

  const inserted = await env.DB.prepare(`
    INSERT INTO user_score_folders (
      user_id,
      folder_name,
      folder_parent
    )
    VALUES (?, ?, ?)
    RETURNING id
  `)
    .bind(userId, folderName, body.folderParent ?? null)
    .first<{ id: number }>();

  if (!inserted) {
    throw new HttpError(500, "Folder was not created");
  }

  return json(
    {
      data: await findFolder(env, inserted.id),
    },
    201,
  );
}

async function getFolder(
  env: Env,
  folderId: number,
): Promise<Response> {
  return json({
    data: await findFolder(env, folderId),
  });
}

async function updateFolder(
  request: Request,
  env: Env,
  folderId: number,
): Promise<Response> {
  const existing = await findFolder(env, folderId);

  const body = await readJson<{
    folderName?: string;
    folderParent?: number | null;
  }>(request);

  const assignments: string[] = [];
  const values: unknown[] = [];

  if (body.folderName !== undefined) {
    assignments.push("folder_name = ?");
    values.push(
      requireText(body.folderName, "folderName", 200),
    );
  }

  if (body.folderParent !== undefined) {
    if (body.folderParent === folderId) {
      throw new HttpError(400, "A folder cannot be its own parent");
    }

    if (body.folderParent !== null) {
      await assertFolderBelongsToUser(
        env,
        body.folderParent,
        existing.user_id,
      );

      await assertFolderMoveDoesNotCreateCycle(
        env,
        folderId,
        body.folderParent,
      );
    }

    assignments.push("folder_parent = ?");
    values.push(body.folderParent);
  }

  if (assignments.length === 0) {
    throw new HttpError(400, "No supported fields were provided");
  }

  assignments.push(
    "modified_datetime = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  );

  await env.DB.prepare(`
    UPDATE user_score_folders
    SET ${assignments.join(", ")}
    WHERE id = ?
  `)
    .bind(...values, folderId)
    .run();

  return json({
    data: await findFolder(env, folderId),
  });
}

async function deleteFolder(
  env: Env,
  folderId: number,
): Promise<Response> {
  await findFolder(env, folderId);

  await env.DB.prepare(`
    DELETE FROM user_score_folders
    WHERE id = ?
  `)
    .bind(folderId)
    .run();

  return new Response(null, { status: 204 });
}

async function findFolder(
  env: Env,
  folderId: number,
): Promise<FolderRow> {
  const folder = await env.DB.prepare(`
    SELECT
      id,
      user_id,
      folder_name,
      folder_parent,
      created_datetime,
      modified_datetime
    FROM user_score_folders
    WHERE id = ?
  `)
    .bind(folderId)
    .first<FolderRow>();

  if (!folder) {
    throw new HttpError(404, "Folder not found");
  }

  return folder;
}

/* -------------------------------------------------------------------------- */
/* Scores                                                                     */
/* -------------------------------------------------------------------------- */

async function listScores(
  env: Env,
  userId: number,
  url: URL,
): Promise<Response> {
  await assertUserExists(env, userId);

  const { limit, offset } = getPagination(url);
  const folderParameter = url.searchParams.get("folder");
  const status = url.searchParams.get("status") ?? "active";
  const query = url.searchParams.get("q")?.trim();

  if (!isScoreStatus(status)) {
    throw new HttpError(400, "Invalid score status");
  }

  const conditions = ["user_id = ?", "status = ?"];
  const values: unknown[] = [userId, status];

  if (folderParameter === "none") {
    conditions.push("folder_id IS NULL");
  } else if (folderParameter !== null) {
    conditions.push("folder_id = ?");
    values.push(parseId(folderParameter));
  }

  if (query) {
    conditions.push(
      "(title LIKE ? OR author LIKE ? OR instrument LIKE ?)",
    );

    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const result = await env.DB.prepare(`
    SELECT
      id,
      user_id,
      folder_id,
      title,
      instrument,
      author,
      score_representation,
      created_datetime,
      modified_datetime,
      modified_by,
      status
    FROM user_scores
    WHERE ${conditions.join(" AND ")}
    ORDER BY modified_datetime DESC
    LIMIT ? OFFSET ?
  `)
    .bind(...values, limit, offset)
    .all<ScoreRow>();

  return json({
    data: result.results,
    pagination: {
      limit,
      offset,
      count: result.results.length,
    },
  });
}

async function createScore(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  await assertActiveUser(env, userId);

  const body = await readJson<{
    folderId?: number | null;
    title?: string;
    instrument?: string | null;
    author?: string | null;
    scoreRepresentation?: string | null;
    modifiedBy?: number | null;
  }>(request);

  if (body.folderId !== undefined && body.folderId !== null) {
    await assertFolderBelongsToUser(env, body.folderId, userId);
  }

  const title = requireText(body.title, "title", 500);

  const inserted = await env.DB.prepare(`
    INSERT INTO user_scores (
      user_id,
      folder_id,
      title,
      instrument,
      author,
      score_representation,
      modified_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `)
    .bind(
      userId,
      body.folderId ?? null,
      title,
      optionalText(body.instrument, "instrument", 200),
      optionalText(body.author, "author", 500),
      body.scoreRepresentation ?? null,
      body.modifiedBy ?? null,
    )
    .first<{ id: number }>();

  if (!inserted) {
    throw new HttpError(500, "Score was not created");
  }

  return json(
    {
      data: await findScore(env, userId, inserted.id),
    },
    201,
  );
}

async function getScore(
  env: Env,
  userId: number,
  scoreId: number,
): Promise<Response> {
  return json({
    data: await findScore(env, userId, scoreId),
  });
}

async function updateScore(
  request: Request,
  env: Env,
  userId: number,
  scoreId: number,
): Promise<Response> {
  const existing = await findScore(env, userId, scoreId);

  const body = await readJson<{
    folderId?: number | null;
    title?: string;
    instrument?: string | null;
    author?: string | null;
    scoreRepresentation?: string | null;
    status?: ScoreStatus;
    modifiedBy?: number | null;
  }>(request);

  const assignments: string[] = [];
  const values: unknown[] = [];

  if (body.folderId !== undefined) {
    if (body.folderId !== null) {
      await assertFolderBelongsToUser(
        env,
        body.folderId,
        existing.user_id,
      );
    }

    assignments.push("folder_id = ?");
    values.push(body.folderId);
  }

  if (body.title !== undefined) {
    assignments.push("title = ?");
    values.push(requireText(body.title, "title", 500));
  }

  if (body.instrument !== undefined) {
    assignments.push("instrument = ?");
    values.push(optionalText(body.instrument, "instrument", 200));
  }

  if (body.author !== undefined) {
    assignments.push("author = ?");
    values.push(optionalText(body.author, "author", 500));
  }

  if (body.scoreRepresentation !== undefined) {
    assignments.push("score_representation = ?");
    values.push(body.scoreRepresentation);
  }

  if (body.status !== undefined) {
    if (!isScoreStatus(body.status)) {
      throw new HttpError(400, "Invalid score status");
    }

    assignments.push("status = ?");
    values.push(body.status);
  }

  if (body.modifiedBy !== undefined) {
    assignments.push("modified_by = ?");
    values.push(body.modifiedBy);
  }

  if (assignments.length === 0) {
    throw new HttpError(400, "No supported fields were provided");
  }

  assignments.push(
    "modified_datetime = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  );

  await env.DB.prepare(`
    UPDATE user_scores
    SET ${assignments.join(", ")}
    WHERE id = ?
  `)
    .bind(...values, scoreId)
    .run();

  return json({
    data: await findScore(env, userId, scoreId),
  });
}

async function deleteScore(
  request: Request,
  env: Env,
  userId: number,
  scoreId: number,
): Promise<Response> {
  await findScore(env, userId, scoreId);

  const body = await readOptionalJson<{
    permanent?: boolean;
    modifiedBy?: number | null;
  }>(request);

  if (body.permanent === true) {
    await env.DB.prepare("DELETE FROM user_scores WHERE user_id = ? AND id = ?")
      .bind(userId, scoreId)
      .run();

    return new Response(null, { status: 204 });
  }

  await env.DB.prepare(`
    UPDATE user_scores
    SET
      status = 'deleted',
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
      modified_by = ?,
      modified_datetime = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `)
    .bind(body.modifiedBy ?? null, scoreId)
    .run();

  return json({
    data: await findScore(env, userId, scoreId),
  });
}

async function findScore(
  env: Env,
  userId: number,
  scoreId: number,
): Promise<ScoreRow> {
  const score = await env.DB.prepare(`
    SELECT
      id,
      user_id,
      folder_id,
      title,
      instrument,
      author,
      score_representation,
      created_datetime,
      modified_datetime,
      modified_by,
      status
    FROM user_scores
    WHERE user_id = ?
    AND id = ?
  `)
    .bind(userId, scoreId)
    .first<ScoreRow>();

  if (!score) {
    throw new HttpError(404, "Score not found");
  }

  return score;
}

/* -------------------------------------------------------------------------- */
/* Ownership and hierarchy checks                                             */
/* -------------------------------------------------------------------------- */

async function assertUserExists(
  env: Env,
  userId: number,
): Promise<void> {
  const user = await env.DB.prepare(`
    SELECT id
    FROM users
    WHERE id = ?
  `)
    .bind(userId)
    .first<{ id: number }>();

  if (!user) {
    throw new HttpError(404, "User not found");
  }
}

async function assertActiveUser(
  env: Env,
  userId: number,
): Promise<void> {
  const user = await env.DB.prepare(`
    SELECT status
    FROM users
    WHERE id = ?
  `)
    .bind(userId)
    .first<{ status: UserStatus }>();

  if (!user) {
    throw new HttpError(404, "User not found");
  }

  if (user.status !== "active") {
    throw new HttpError(409, "User is not active");
  }
}

async function assertFolderBelongsToUser(
  env: Env,
  folderId: number,
  userId: number,
): Promise<void> {
  const folder = await env.DB.prepare(`
    SELECT id
    FROM user_score_folders
    WHERE id = ? AND user_id = ?
  `)
    .bind(folderId, userId)
    .first<{ id: number }>();

  if (!folder) {
    throw new HttpError(
      400,
      "Folder does not exist or belongs to another user",
    );
  }
}

async function assertFolderMoveDoesNotCreateCycle(
  env: Env,
  folderId: number,
  proposedParentId: number,
): Promise<void> {
  const descendant = await env.DB.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id
      FROM user_score_folders
      WHERE folder_parent = ?

      UNION ALL

      SELECT child.id
      FROM user_score_folders child
      INNER JOIN descendants d
        ON child.folder_parent = d.id
    )
    SELECT id
    FROM descendants
    WHERE id = ?
    LIMIT 1
  `)
    .bind(folderId, proposedParentId)
    .first<{ id: number }>();

  if (descendant) {
    throw new HttpError(
      400,
      "Moving this folder would create a folder cycle",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

function serializeUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    type: user.type,
    createdDatetime: user.created_datetime,
    modifiedDatetime: user.modified_datetime,
    modifiedBy: user.modified_by,
    status: user.status,
    hasAvatar: Boolean(user.has_avatar),
    avatarUrl: user.has_avatar
      ? `/api/users/${user.id}/avatar`
      : null,
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function withCors(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);

  headers.set(
    "Access-Control-Allow-Origin",
    env.ALLOWED_ORIGIN ?? "*",
  );

  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );

  headers.set("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function parseId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new HttpError(400, "Invalid numeric ID");
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, "Invalid numeric ID");
  }

  return id;
}

function getPagination(url: URL): {
  limit: number;
  offset: number;
} {
  const requestedLimit = Number(
    url.searchParams.get("limit") ?? "50",
  );

  const requestedOffset = Number(
    url.searchParams.get("offset") ?? "0",
  );

  const limit =
    Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 50;

  const offset =
    Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;

  return { limit, offset };
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType =
    request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    throw new HttpError(
      415,
      "Content-Type must be application/json",
    );
  }

  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function readOptionalJson<T extends object>(
  request: Request,
): Promise<T> {
  const contentLength = request.headers.get("content-length");

  if (contentLength === "0" || request.body === null) {
    return {} as T;
  }

  return readJson<T>(request);
}

function requireText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field} is required`);
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    throw new HttpError(
      400,
      `${field} must not exceed ${maxLength} characters`,
    );
  }

  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`);
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    throw new HttpError(
      400,
      `${field} must not exceed ${maxLength} characters`,
    );
  }

  return normalized || null;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpError(400, "Invalid email address");
  }

  return normalized;
}

function isUserType(value: string): value is UserType {
  return value === "admin" || value === "regular";
}

function isUserStatus(value: string): value is UserStatus {
  return (
    value === "active" ||
    value === "suspended" ||
    value === "deleted"
  );
}

function isScoreStatus(value: string): value is ScoreStatus {
  return value === "active" || value === "deleted";
}

function isPng(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) {
    return false;
  }

  const bytes = new Uint8Array(buffer, 0, 8);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  return signature.every((byte, index) => bytes[index] === byte);
}

function throwD1ConstraintError(
  error: unknown,
  friendlyMessage: string,
): never {
  const message =
    error instanceof Error ? error.message : String(error);

  if (
    message.includes("UNIQUE constraint failed") ||
    message.includes("constraint failed")
  ) {
    throw new HttpError(409, friendlyMessage);
  }

  throw error;
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{
    username?: string;
    email?: string;
    passwordHash?: string;
  }>(request);

  const identifier = body.username || body.email;
  if (!identifier) {
    throw new HttpError(400, "username or email is required");
  }

  const passwordHash = requireText(body.passwordHash, "passwordHash", 512);

  // Find user by username or email
  const user = await env.DB.prepare(`
    SELECT *
    FROM users
    WHERE (username = ? OR email = ?) AND status = 'active'
  `)
    .bind(identifier, identifier)
    .first<{
      id: number;
      username: string;
      email: string;
      password_hash: string;
      type: UserType;
      created_datetime: string;
      modified_datetime: string;
      modified_by: number | null;
      status: UserStatus;
      avatar: number[] | null;
    }>();

  if (!user || user.password_hash !== passwordHash) {
    throw new HttpError(401, "Invalid username, email, or password");
  }

  const token = crypto.randomUUID();
  const expires = new Date();
  expires.setDate(expires.getDate() + 7); // 7 days from now
  const expiresDatetime = expires.toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions (token, user_id, expires_datetime)
    VALUES (?, ?, ?)
  `)
    .bind(token, user.id, expiresDatetime)
    .run();

  const serialized = {
    id: user.id,
    username: user.username,
    email: user.email,
    type: user.type,
    createdDatetime: user.created_datetime,
    modifiedDatetime: user.modified_datetime,
    modifiedBy: user.modified_by,
    status: user.status,
    hasAvatar: user.avatar !== null,
    avatarUrl: user.avatar !== null ? `/api/users/${user.id}/avatar` : null,
  };

  return json({
    data: {
      token,
      expiresDatetime,
      user: serialized,
    },
  });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = getSessionToken(request, url);

  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?")
      .bind(token)
      .run();
  }

  return new Response(null, { status: 204 });
}

async function getSession(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = getSessionToken(request, url);

  if (!token) {
    throw new HttpError(401, "Authorization token is missing");
  }

  const session = await env.DB.prepare(`
    SELECT s.token, s.expires_datetime, u.id, u.username, u.email, u.type, u.created_datetime, u.modified_datetime, u.modified_by, u.status, u.avatar
    FROM sessions s
    INNER JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `)
    .bind(token)
    .first<{
      token: string;
      expires_datetime: string;
      id: number;
      username: string;
      email: string;
      type: UserType;
      created_datetime: string;
      modified_datetime: string;
      modified_by: number | null;
      status: UserStatus;
      avatar: number[] | null;
    }>();

  if (!session) {
    throw new HttpError(401, "Session not found");
  }

  // Check expiration
  if (new Date(session.expires_datetime) < new Date()) {
    // Delete expired session
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?")
      .bind(token)
      .run();
    throw new HttpError(401, "Session has expired");
  }

  const serialized = {
    id: session.id,
    username: session.username,
    email: session.email,
    type: session.type,
    createdDatetime: session.created_datetime,
    modifiedDatetime: session.modified_datetime,
    modifiedBy: session.modified_by,
    status: session.status,
    hasAvatar: session.avatar !== null,
    avatarUrl: session.avatar !== null ? `/api/users/${session.id}/avatar` : null,
  };

  return json({
    data: {
      user: serialized,
      expiresDatetime: session.expires_datetime,
    },
  });
}

function getSessionToken(request: Request, url: URL): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }
  const tokenParam = url.searchParams.get("token");
  if (tokenParam) {
    return tokenParam.trim();
  }
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;)\s*session_token\s*=\s*([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}
