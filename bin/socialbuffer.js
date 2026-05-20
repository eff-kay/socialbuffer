#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:https";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import process from "node:process";

const PRIMARY_CLI_NAME = "socialbuffer";
const LEGACY_CLI_NAME = "tweetx";
const BUFFER_ENDPOINT = "https://api.buffer.com";
const X_API_ENDPOINT = "https://api.x.com/2";
const VALID_MODES = new Set(["addToQueue", "shareNow", "customScheduled"]);
const VALID_EDIT_MODES = new Set(["addToQueue", "shareNow", "shareNext", "customScheduled", "recommendedTime"]);
const VALID_POST_PLATFORMS = new Set(["x", "linkedin"]);
const VALID_SORTS = new Set(["engagement", "recent", "likes", "reposts", "replies", "quotes"]);

function printHelp() {
  console.log(`${PRIMARY_CLI_NAME} (alias: ${LEGACY_CLI_NAME})

Usage:
  ${PRIMARY_CLI_NAME} channels [--service twitter|x|linkedin] [--api-key API_KEY]
  ${PRIMARY_CLI_NAME} post --file path/to/post.md [--platform x|linkedin] [--image path/to/file.png | --image-url https://... | --video-url https://...] [--alt "alt text"] [--thumbnail-url https://...] [--video-title "title"] [--mode addToQueue|shareNow|customScheduled] [--due-at 2026-04-13T09:00:00-04:00] [--channel CHANNEL_ID] [--api-key API_KEY] [--dry-run]
  ${PRIMARY_CLI_NAME} edit --id BUFFER_POST_ID [--file path/to/post.md | --text "replacement text"] [--mode addToQueue|shareNow|shareNext|customScheduled|recommendedTime] [--due-at 2026-04-13T09:00:00-04:00] [--api-key API_KEY] [--dry-run]
  ${PRIMARY_CLI_NAME} reschedule --id BUFFER_POST_ID --due-at 2026-04-13T09:00:00-04:00 [--file path/to/post.md | --text "replacement text"] [--api-key API_KEY] [--dry-run]
  ${PRIMARY_CLI_NAME} delete --id BUFFER_POST_ID [--api-key API_KEY] [--dry-run]
  ${PRIMARY_CLI_NAME} analytics --username USERNAME [--limit N] [--sort engagement|recent|likes|reposts|replies|quotes] [--include-replies true|false] [--include-retweets true|false] [--x-token TOKEN]

Environment:
  BUFFER_API_KEY      Buffer API key
  BUFFER_X_CHANNEL_ID Buffer X channel ID
  BUFFER_LINKEDIN_CHANNEL_ID Buffer LinkedIn channel ID
  BUFFER_CHANNEL_ID   Legacy fallback for Buffer X channel ID
  X_BEARER_TOKEN      X app Bearer token for read-only analytics
  TWITTER_BEARER_TOKEN Alias for X_BEARER_TOKEN
  SOCIALBUFFER_ENV_FILE Optional path to an env file
  TWEETX_ENV_FILE     Legacy alias for SOCIALBUFFER_ENV_FILE

Examples:
  ${PRIMARY_CLI_NAME} channels
  ${PRIMARY_CLI_NAME} channels --service twitter
  ${PRIMARY_CLI_NAME} channels --service linkedin
  ${PRIMARY_CLI_NAME} post --file ./post.md
  ${PRIMARY_CLI_NAME} post --platform linkedin --file ./post.md
  ${PRIMARY_CLI_NAME} post --file ./post.md --image ./shot.png
  ${PRIMARY_CLI_NAME} post --file ./post.md --image-url https://example.com/shot.png
  ${PRIMARY_CLI_NAME} post --file ./post.md --video-url https://example.com/clip.mp4
  ${PRIMARY_CLI_NAME} post --file ./post.md --mode shareNow
  ${PRIMARY_CLI_NAME} post --file ./post.md --dry-run
  ${PRIMARY_CLI_NAME} reschedule --id 123 --due-at 2026-04-13T09:00:00-04:00
  ${PRIMARY_CLI_NAME} delete --id 123
  ${PRIMARY_CLI_NAME} analytics --username xdevelopers
  ${PRIMARY_CLI_NAME} analytics --username xdevelopers --limit 20 --sort likes
`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseEnvFile(envPath) {
  if (!existsSync(envPath)) {
    return {};
  }

  const raw = readFileSync(envPath, "utf8");
  const values = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    values[key] = value;
  }

  return values;
}

function resolveEnvPaths() {
  const paths = [];
  const customEnvPath = process.env.SOCIALBUFFER_ENV_FILE || process.env.TWEETX_ENV_FILE;

  if (customEnvPath) {
    paths.push(resolve(customEnvPath));
  } else {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    paths.push(join(xdgConfigHome, PRIMARY_CLI_NAME, ".env"));
    paths.push(join(homedir(), `.${PRIMARY_CLI_NAME}`, ".env"));
    paths.push(join(xdgConfigHome, "tweetx", ".env"));
    paths.push(join(homedir(), ".tweetx", ".env"));
  }

  paths.push(resolve(".env"));
  return [...new Set(paths)];
}

function loadEnvFiles() {
  const originalKeys = new Set(Object.keys(process.env));

  for (const envPath of resolveEnvPaths()) {
    const values = parseEnvFile(envPath);
    for (const [key, value] of Object.entries(values)) {
      if (originalKeys.has(key)) {
        continue;
      }

      process.env[key] = value;
    }
  }
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }

  const closingIndex = markdown.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return markdown;
  }

  return markdown.slice(closingIndex + 5);
}

function normalizeMarkdown(markdown) {
  const withoutBom = markdown.replace(/^\uFEFF/, "");
  const withoutFrontmatter = stripFrontmatter(withoutBom);
  return withoutFrontmatter.replace(/\r\n/g, "\n").trim();
}

function markdownToPlainText(markdown) {
  return normalizeMarkdown(markdown)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help" };
  }

  const [command, ...rest] = argv;
  const options = {
    mode: "addToQueue",
    dryRun: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (!token.startsWith("--")) {
      fail(`unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`missing value for --${key}`);
    }

    options[key] = value;
    i += 1;
  }

  return { command, options };
}

async function loadPostText(filePath) {
  const raw = await readFile(filePath, "utf8");
  const text = markdownToPlainText(raw);
  if (!text) {
    fail("post file is empty after trimming");
  }
  return text;
}

function loadInlineText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    fail("--text is empty after trimming");
  }

  return normalized;
}

function getMimeType(filePath) {
  const extension = extname(filePath).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      fail(`unsupported image type: ${extension || "unknown"}`);
  }
}

function defaultAltText(filePath) {
  const filename = basename(filePath, extname(filePath));
  return filename.replace(/[_-]+/g, " ").trim() || "Attached image";
}

async function loadImageAsset(filePath, altText) {
  const bytes = await readFile(filePath);
  const mimeType = getMimeType(filePath);
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  return [
    {
      image: {
        url: dataUrl,
        metadata: {
          altText: altText || defaultAltText(filePath),
        },
      },
    },
  ];
}

function loadRemoteImageAsset(imageUrl, altText, thumbnailUrl) {
  return [
    {
      image: {
        url: imageUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        metadata: {
          altText: altText || "Attached image",
        },
      },
    },
  ];
}

function loadRemoteVideoAsset(videoUrl, { thumbnailUrl, title }) {
  return [
    {
      video: {
        url: videoUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        metadata: title
          ? {
              title,
            }
          : undefined,
      },
    },
  ];
}

async function postJson(url, apiKey, body) {
  const target = new URL(url);

  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let payload = null;

          if (responseBody) {
            try {
              payload = JSON.parse(responseBody);
            } catch (error) {
              rejectPromise(
                new Error(
                  `Buffer returned invalid JSON with status ${response.statusCode || "unknown"}`,
                ),
              );
              return;
            }
          }

          resolvePromise({
            ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300,
            status: response.statusCode || 500,
            payload,
          });
        });
      },
    );

    req.on("error", (error) => {
      rejectPromise(error);
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

async function getJson(url, token) {
  const target = new URL(url);

  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(
      {
        method: "GET",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let payload = null;

          if (responseBody) {
            try {
              payload = JSON.parse(responseBody);
            } catch (error) {
              rejectPromise(
                new Error(
                  `X returned invalid JSON with status ${response.statusCode || "unknown"}`,
                ),
              );
              return;
            }
          }

          resolvePromise({
            ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300,
            status: response.statusCode || 500,
            payload,
          });
        });
      },
    );

    req.on("error", (error) => {
      rejectPromise(error);
    });

    req.end();
  });
}

async function createBufferPost({ apiKey, channelId, text, mode, assets, dueAt }) {
  const query = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess {
          post {
            id
            text
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const { ok, status, payload } = await postJson(BUFFER_ENDPOINT, apiKey, {
    query,
    variables: {
      input: {
        channelId,
        mode,
        schedulingType: "automatic",
        dueAt: dueAt || null,
        text,
        assets,
      },
    },
  });

  if (!ok) {
    const detail = payload ? JSON.stringify(payload) : "Request failed";
    fail(`Buffer request failed with ${status}: ${detail}`);
  }

  if (payload?.errors?.length) {
    fail(payload.errors.map((item) => item.message).join("; "));
  }

  const result = payload?.data?.createPost;
  if (!result) {
    fail("Buffer response did not include createPost");
  }

  if (result.__typename !== "PostActionSuccess" || !result.post) {
    fail(result.message || `unexpected Buffer response type: ${result.__typename || "unknown"}`);
  }

  return result.post;
}

async function fetchBufferPost({ apiKey, id }) {
  const data = await queryBufferGraphql({
    apiKey,
    query: `
      query Post($input: PostInput!) {
        post(input: $input) {
          id
          status
          dueAt
          sentAt
          createdAt
          updatedAt
          text
          externalLink
          channelId
          channelService
          shareMode
          sharedNow
          allowedActions
          channel {
            id
            service
            name
            displayName
            timezone
          }
        }
      }
    `,
    variables: {
      input: { id },
    },
  });

  if (!data?.post) {
    fail(`Buffer post not found: ${id}`);
  }

  return data.post;
}

async function editBufferPost({ apiKey, id, text, mode, dueAt }) {
  const data = await queryBufferGraphql({
    apiKey,
    query: `
      mutation EditPost($input: EditPostInput!) {
        editPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post {
              id
              text
              status
              dueAt
              sentAt
              shareMode
            }
          }
          ... on NotFoundError {
            message
          }
          ... on UnauthorizedError {
            message
          }
          ... on UnexpectedError {
            message
          }
          ... on RestProxyError {
            message
          }
          ... on LimitReachedError {
            message
          }
          ... on InvalidInputError {
            message
          }
        }
      }
    `,
    variables: {
      input: {
        id,
        schedulingType: "automatic",
        dueAt: dueAt || null,
        text,
        mode,
      },
    },
  });

  const result = data?.editPost;
  if (!result) {
    fail("Buffer response did not include editPost");
  }

  if (result.__typename !== "PostActionSuccess" || !result.post) {
    fail(result.message || `unexpected Buffer response type: ${result.__typename || "unknown"}`);
  }

  return result.post;
}

async function deleteBufferPost({ apiKey, id }) {
  const data = await queryBufferGraphql({
    apiKey,
    query: `
      mutation DeletePost($input: DeletePostInput!) {
        deletePost(input: $input) {
          __typename
          ... on DeletePostSuccess {
            id
          }
          ... on VoidMutationError {
            message
          }
        }
      }
    `,
    variables: {
      input: { id },
    },
  });

  const result = data?.deletePost;
  if (!result) {
    fail("Buffer response did not include deletePost");
  }

  if (result.__typename !== "DeletePostSuccess") {
    fail(result.message || `unexpected Buffer response type: ${result.__typename || "unknown"}`);
  }

  return result;
}

async function queryBufferGraphql({ apiKey, query, variables }) {
  const { ok, status, payload } = await postJson(BUFFER_ENDPOINT, apiKey, {
    query,
    variables,
  });

  if (!ok) {
    const detail = payload ? JSON.stringify(payload) : "Request failed";
    fail(`Buffer request failed with ${status}: ${detail}`);
  }

  if (payload?.errors?.length) {
    fail(payload.errors.map((item) => item.message).join("; "));
  }

  return payload?.data;
}

function validateModeAndDueAt(mode, dueAt, validModes = VALID_MODES) {
  if (!validModes.has(mode)) {
    fail(`--mode must be one of: ${Array.from(validModes).join(", ")}`);
  }

  if (mode === "customScheduled" && !dueAt) {
    fail("--due-at is required when --mode customScheduled is used");
  }

  if (mode !== "customScheduled" && dueAt) {
    fail("--due-at can only be used with --mode customScheduled");
  }
}

function assertPostActionAllowed(post, actions) {
  const expectedActions = Array.isArray(actions) ? actions : [actions];
  if (!Array.isArray(post.allowedActions) || expectedActions.some((action) => post.allowedActions.includes(action))) {
    return;
  }

  const channel = post.channel?.displayName || post.channel?.name || post.channelId;
  fail(
    `Buffer will not allow ${expectedActions.join("/")} for post ${post.id} (${post.status}) on ${channel}. Allowed actions: ${post.allowedActions.join(", ")}`,
  );
}

async function resolveEditText({ options, existingText }) {
  if (options.file && options.text) {
    fail("use either --file or --text, not both");
  }

  if (options.text) {
    return loadInlineText(options.text);
  }

  if (options.file) {
    return loadPostText(options.file);
  }

  if (!existingText) {
    fail("No existing post text found; pass --file or --text");
  }

  return existingText;
}

function parseBooleanOption(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  fail(`expected boolean string 'true' or 'false', got: ${value}`);
}

function parseLimit(value, fallback = 10) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 100) {
    fail("--limit must be an integer between 5 and 100");
  }

  return parsed;
}

function normalizeXMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") {
    return {
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
      impressions: 0,
    };
  }

  return {
    likes: metrics.like_count || 0,
    reposts: metrics.retweet_count || metrics.repost_count || 0,
    replies: metrics.reply_count || 0,
    quotes: metrics.quote_count || 0,
    bookmarks: metrics.bookmark_count || 0,
    impressions: metrics.impression_count || 0,
  };
}

function computeEngagementScore(metrics) {
  return (
    metrics.likes +
    metrics.reposts * 2 +
    metrics.replies * 2 +
    metrics.quotes * 3 +
    metrics.bookmarks
  );
}

function sortAnalytics(items, sort) {
  const copy = [...items];

  copy.sort((left, right) => {
    if (sort === "recent") {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    }

    if (sort === "likes") {
      return right.metrics.likes - left.metrics.likes;
    }

    if (sort === "reposts") {
      return right.metrics.reposts - left.metrics.reposts;
    }

    if (sort === "replies") {
      return right.metrics.replies - left.metrics.replies;
    }

    if (sort === "quotes") {
      return right.metrics.quotes - left.metrics.quotes;
    }

    return right.score - left.score;
  });

  return copy;
}

async function xGet({ token, path, query }) {
  const url = new URL(`${X_API_ENDPOINT}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  const { ok, status, payload } = await getJson(url.toString(), token);
  if (!ok) {
    const detail = payload ? JSON.stringify(payload) : "Request failed";
    fail(`X request failed with ${status}: ${detail}`);
  }

  if (payload?.errors?.length) {
    fail(payload.errors.map((item) => item.detail || item.message).join("; "));
  }

  return payload;
}

async function lookupXUser({ token, username }) {
  const payload = await xGet({
    token,
    path: `/users/by/username/${encodeURIComponent(username)}`,
    query: {
      "user.fields": "public_metrics",
    },
  });

  if (!payload?.data?.id) {
    fail(`Could not find X user: ${username}`);
  }

  return payload.data;
}

async function listXPosts({ token, userId, limit, includeReplies, includeRetweets }) {
  const exclude = [];
  if (!includeReplies) {
    exclude.push("replies");
  }
  if (!includeRetweets) {
    exclude.push("retweets");
  }

  const payload = await xGet({
    token,
    path: `/users/${encodeURIComponent(userId)}/tweets`,
    query: {
      max_results: limit,
      exclude: exclude.join(","),
      "tweet.fields": "created_at,public_metrics,lang",
    },
  });

  return Array.isArray(payload?.data) ? payload.data : [];
}

function normalizeServiceFilter(service) {
  if (!service) {
    return null;
  }

  const normalized = service.toLowerCase();

  if (normalized === "x") {
    return "twitter";
  }

  return normalized;
}

function normalizePostPlatform(platform) {
  if (!platform) {
    return "x";
  }

  const normalized = platform.toLowerCase();

  if (normalized === "twitter") {
    return "x";
  }

  if (!VALID_POST_PLATFORMS.has(normalized)) {
    fail(`--platform must be one of: ${Array.from(VALID_POST_PLATFORMS).join(", ")}`);
  }

  return normalized;
}

function resolveChannelId({ platform, channel }) {
  if (channel) {
    return channel;
  }

  if (platform === "linkedin") {
    return process.env.BUFFER_LINKEDIN_CHANNEL_ID;
  }

  return process.env.BUFFER_X_CHANNEL_ID || process.env.BUFFER_CHANNEL_ID;
}

async function listBufferProfiles({ apiKey, service }) {
  const normalizedService = normalizeServiceFilter(service);

  const accountData = await queryBufferGraphql({
    apiKey,
    query: `
      query AccountOrganizations {
        account {
          id
          organizations {
            id
            name
          }
        }
      }
    `,
  });

  const organizations = accountData?.account?.organizations;
  if (!Array.isArray(organizations) || organizations.length === 0) {
    fail("No Buffer organizations found for this account");
  }

  const profiles = [];

  for (const organization of organizations) {
    const channelsData = await queryBufferGraphql({
      apiKey,
      query: `
        query Channels($input: ChannelsInput!) {
          channels(input: $input) {
            id
            name
            service
            displayName
            descriptor
            timezone
            organizationId
          }
        }
      `,
      variables: {
        input: {
          organizationId: organization.id,
        },
      },
    });

    const channels = channelsData?.channels;
    if (!Array.isArray(channels)) {
      continue;
    }

    for (const channel of channels) {
      if (normalizedService && channel?.service !== normalizedService) {
        continue;
      }

      profiles.push({
        id: channel.id,
        organizationId: channel.organizationId,
        organizationName: organization.name,
        service: channel.service,
        name: channel.name,
        displayName: channel.displayName || null,
        descriptor: channel.descriptor || null,
        timezone: channel.timezone || null,
      });
    }
  }

  return profiles;
}

async function handleChannels(options) {
  const apiKey = options["api-key"] || process.env.BUFFER_API_KEY;
  if (!apiKey) {
    fail("BUFFER_API_KEY is required");
  }

  const profiles = await listBufferProfiles({
    apiKey,
    service: options.service,
  });

  console.log(JSON.stringify(profiles, null, 2));
}

async function handlePost(options) {
  const filePath = options.file;
  if (!filePath) {
    fail("--file is required");
  }

  const apiKey = options["api-key"] || process.env.BUFFER_API_KEY;
  const platform = normalizePostPlatform(options.platform);
  const channelId = resolveChannelId({ platform, channel: options.channel });
  const mode = options.mode || "addToQueue";
  const dueAt = options["due-at"] || "";
  const imagePath = options.image;
  const imageUrl = options["image-url"];
  const videoUrl = options["video-url"];
  const thumbnailUrl = options["thumbnail-url"];
  const videoTitle = options["video-title"];

  validateModeAndDueAt(mode, dueAt, VALID_MODES);

  const selectedMediaCount = [imagePath, imageUrl, videoUrl].filter(Boolean).length;
  if (selectedMediaCount > 1) {
    fail("use only one media source: --image, --image-url, or --video-url");
  }

  if (videoTitle && !videoUrl) {
    fail("--video-title requires --video-url");
  }

  if (thumbnailUrl && !imageUrl && !videoUrl) {
    fail("--thumbnail-url requires --image-url or --video-url");
  }

  if (!apiKey && !options.dryRun) {
    fail("BUFFER_API_KEY is required unless --dry-run is used");
  }

  if (!channelId) {
    if (platform === "linkedin") {
      fail("BUFFER_LINKEDIN_CHANNEL_ID or --channel is required for --platform linkedin");
    }

    fail("BUFFER_X_CHANNEL_ID, BUFFER_CHANNEL_ID, or --channel is required for --platform x");
  }

  const text = await loadPostText(filePath);
  const assets = imagePath
    ? await loadImageAsset(imagePath, options.alt)
    : imageUrl
      ? loadRemoteImageAsset(imageUrl, options.alt, thumbnailUrl)
      : videoUrl
        ? loadRemoteVideoAsset(videoUrl, { thumbnailUrl, title: videoTitle })
        : undefined;

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          channelId,
          filePath,
          imagePath: imagePath || null,
          imageUrl: imageUrl || null,
          videoUrl: videoUrl || null,
          thumbnailUrl: thumbnailUrl || null,
          videoTitle: videoTitle || null,
          mode,
          dueAt: dueAt || null,
          platform,
          text,
          hasAssets: Boolean(assets),
        },
        null,
        2,
      ),
    );
    return;
  }

  const post = await createBufferPost({
    apiKey,
    channelId,
    mode,
    dueAt,
    text,
    assets,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        channelId,
        id: post.id,
        dueAt: dueAt || null,
        mode,
        platform,
        text: post.text,
      },
      null,
      2,
    ),
  );
}

async function handleEdit(options) {
  const id = options.id;
  if (!id) {
    fail("--id is required");
  }

  const apiKey = options["api-key"] || process.env.BUFFER_API_KEY;
  const mode = options.mode || "addToQueue";
  const dueAt = options["due-at"] || "";
  validateModeAndDueAt(mode, dueAt, VALID_EDIT_MODES);

  if (!apiKey && !options.dryRun) {
    fail("BUFFER_API_KEY is required unless --dry-run is used");
  }

  const existingPost = await fetchBufferPost({ apiKey, id });
  const text = await resolveEditText({ options, existingText: existingPost.text });

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "edit",
          id,
          existingStatus: existingPost.status,
          existingShareMode: existingPost.shareMode,
          existingDueAt: existingPost.dueAt,
          allowedActions: existingPost.allowedActions,
          mode,
          dueAt: dueAt || null,
          text,
        },
        null,
        2,
      ),
    );
    return;
  }

  assertPostActionAllowed(existingPost, ["updatePost", "updatePostSchedule"]);
  const post = await editBufferPost({ apiKey, id, text, mode, dueAt });

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "edit",
        id: post.id,
        status: post.status,
        mode: post.shareMode,
        dueAt: post.dueAt,
        sentAt: post.sentAt,
        text: post.text,
      },
      null,
      2,
    ),
  );
}

async function handleReschedule(options) {
  await handleEdit({
    ...options,
    mode: "customScheduled",
  });
}

async function handleDelete(options) {
  const id = options.id;
  if (!id) {
    fail("--id is required");
  }

  const apiKey = options["api-key"] || process.env.BUFFER_API_KEY;
  if (!apiKey && !options.dryRun) {
    fail("BUFFER_API_KEY is required unless --dry-run is used");
  }

  const existingPost = await fetchBufferPost({ apiKey, id });

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "delete",
          id,
          existingStatus: existingPost.status,
          existingDueAt: existingPost.dueAt,
          allowedActions: existingPost.allowedActions,
          text: existingPost.text,
        },
        null,
        2,
      ),
    );
    return;
  }

  assertPostActionAllowed(existingPost, "deletePost");
  const result = await deleteBufferPost({ apiKey, id });

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "delete",
        id: result.id,
      },
      null,
      2,
    ),
  );
}

async function handleAnalytics(options) {
  const username = options.username;
  if (!username) {
    fail("--username is required");
  }

  const token =
    options["x-token"] || process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    fail("X_BEARER_TOKEN or --x-token is required");
  }

  const limit = parseLimit(options.limit, 10);
  const sort = options.sort || "engagement";
  if (!VALID_SORTS.has(sort)) {
    fail(`--sort must be one of: ${Array.from(VALID_SORTS).join(", ")}`);
  }

  const includeReplies = parseBooleanOption(options["include-replies"], false);
  const includeRetweets = parseBooleanOption(options["include-retweets"], false);

  const user = await lookupXUser({ token, username });
  const posts = await listXPosts({
    token,
    userId: user.id,
    limit,
    includeReplies,
    includeRetweets,
  });

  const ranked = sortAnalytics(
    posts.map((post) => {
      const metrics = normalizeXMetrics(post.public_metrics);
      return {
        id: post.id,
        createdAt: post.created_at,
        text: post.text,
        url: `https://x.com/${username}/status/${post.id}`,
        metrics,
        score: computeEngagementScore(metrics),
      };
    }),
    sort,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        username,
        userId: user.id,
        sort,
        count: ranked.length,
        tweets: ranked,
      },
      null,
      2,
    ),
  );
}

async function main() {
  loadEnvFiles();

  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "channels") {
    await handleChannels(options);
    return;
  }

  if (command === "post") {
    await handlePost(options);
    return;
  }

  if (command === "edit") {
    await handleEdit(options);
    return;
  }

  if (command === "reschedule") {
    await handleReschedule(options);
    return;
  }

  if (command === "delete") {
    await handleDelete(options);
    return;
  }

  if (command === "analytics") {
    await handleAnalytics(options);
    return;
  }

  if (command !== "post") {
    fail(`unsupported command: ${command}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
