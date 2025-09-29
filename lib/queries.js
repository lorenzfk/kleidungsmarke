// lib/queries.js
// Product query + a helper to resolve FILE ids via nodes(ids:…)
export const LANDING_QUERY = /* GraphQL */ `
  query Landing {
    collection(handle: "featured") {
      products(first: 50) { nodes { ...ProductFields } }
    }
    products(first: 50, sortKey: CREATED_AT, reverse: true) {
      nodes { ...ProductFields }
    }
  }

  fragment ProductFields on Product {
    id
    handle
    title
    featuredImage { url }
    variants(first: 1) { nodes { id price { amount currencyCode } } }

    # FILE metafields (we read both value + reference)
    model_file: metafield(namespace: "three", key: "model_glb") {
      value
      type
      reference {
        __typename
        ... on Model3d { sources { url mimeType format } }
        ... on GenericFile { url }
        ... on MediaImage { image { url } }
      }
    }
    poster_image: metafield(namespace: "three", key: "poster_image") {
      value
      type
      reference {
        __typename
        ... on MediaImage { image { url } }
        ... on GenericFile { url }
      }
    }

    show_on_landing: metafield(namespace: "three", key: "show_on_landing") {
      value
      type
    }

    # Fallbacks from product media (Storefront union excludes GenericFile)
    media(first: 10) {
      nodes {
        __typename
        ... on MediaImage { image { url } }
        ... on Model3d { sources { url mimeType format } }
      }
    }
  }
`;

export const FILES_BY_IDS = /* GraphQL */ `
  query FilesByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      id
      ... on GenericFile { url }
      ... on MediaImage { image { url } }
      # Model3d is not a File node; it's only in product.media
    }
  }
`;
