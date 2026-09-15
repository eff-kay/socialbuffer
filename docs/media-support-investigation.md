# Media support investigation

## Goal

Figure out how `socialbuffer` should support image and video posts through Buffer.

## What Buffer expects

Buffer's GraphQL schema exposes `CreatePostInput.assets` and `EditPostInput.assets` as:

- `assets: [AssetInput!]!`
- each `AssetInput` can contain one of:
  - `image: ImageAssetInput`
  - `video: VideoAssetInput`
  - `document: DocumentAssetInput`
  - `link: LinkAssetInput`

Relevant shapes:

```graphql
input ImageAssetInput {
  url: String!
  thumbnailUrl: String
  metadata: ImageMetadataInput
}

input ImageMetadataInput {
  altText: String!
  animatedThumbnail: String
  userTags: [UserTagInput!]
  dimensions: ImageDimensionsInput
}

input VideoAssetInput {
  url: String!
  thumbnailUrl: String
  metadata: VideoMetadataInput
}

input VideoMetadataInput {
  thumbnailOffset: Int
  title: String
}
```

## Live investigation results

Using the real Buffer API:

1. **Current CLI image asset shape is wrong**
   - Current code sends an object like `{ images: [...] }`
   - Buffer rejects it with:
     - `Field "images" is not defined by type "AssetInput"`

2. **Remote image URLs work**
   - A test post created successfully when the asset was sent as:

```json
[
  {
    "image": {
      "url": "https://placehold.co/600x400/png",
      "metadata": {
        "altText": "placeholder"
      }
    }
  }
]
```

3. **Remote video URLs work**
   - A test post created successfully when the asset was sent as:

```json
[
  {
    "video": {
      "url": "https://samplelib.com/lib/preview/mp4/sample-5s.mp4",
      "thumbnailUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/640px-Fronalpstock_big.jpg",
      "metadata": {
        "title": "sample video"
      }
    }
  }
]
```

4. **Data URLs do not work for images**
   - Buffer returned:
     - `Failed to create post: Failed to fetch image dimensions: Not Found`
   - This means the current local-file approach of base64-encoding into a `data:` URL is not a viable media path.

## Practical conclusion

Buffer appears to want **fetchable media URLs**, not inline base64 payloads.

That means:

- `--image-url` can be supported directly
- `--video-url` can be supported directly
- local `--image` / `--video` support will need an intermediate upload/hosting step before calling Buffer

## Recommended CLI design

### Phase 1: reliable remote media support

Implement and document:

- `--image-url <https-url>`
- `--video-url <https-url>`
- `--thumbnail-url <https-url>` for video posts
- `--video-title <string>` optional metadata

Rules:

- only one primary media flag at a time for the first version
- keep `--alt` for image alt text
- reject `--image` and `--video` local files until a hosting path exists

### Phase 2: local media support

Add a pre-upload step that turns a local file into a stable public URL before calling Buffer.

Possible options:

- upload to a user-controlled object store
- upload to a lightweight media host
- add a plugin/provider abstraction for temporary hosting

## Suggested implementation changes

1. Replace the current image asset builder with the real `AssetInput` shape.
2. Add a video asset builder.
3. Refactor post/edit code paths so both can accept media assets.
4. Validate media flag combinations clearly.
5. Add smoke tests around the asset payload builders.
6. Only bring back local file flags once a real hosting step exists.

## Important note

The repo currently documents image posting more optimistically than the live API behavior supports. Any implementation PR should update the README at the same time so docs match reality.
