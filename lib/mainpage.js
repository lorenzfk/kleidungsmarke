// lib/mainpage.js
'use server';

import { shopifyFetch } from '@/lib/shopify';

function resolveField(node, key) {
  if (!node) return null;
  const dir = node.fields?.find?.((f) => f?.key === key);
  if (dir) return dir;
  const direct = node[key];
  if (direct && typeof direct === 'object') return direct;
  return null;
}

function extractText(node, key) {
  const field = resolveField(node, key);
  return (field?.value || '').trim();
}

function extractBackground(node) {
  const field = resolveField(node, 'background');
  if (!field) return null;
  const ref = field.reference;
  if (ref?.__typename === 'MediaImage') return ref.image?.url || null;
  if (ref?.url) return ref.url;
  const raw = field.value || '';
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) return raw;
  return raw;
}

export async function getMainpageData() {
  const QUERY = /* GraphQL */ `
    query MainpageMetaobject {
      main: metaobject(handle: { handle: "mainpage", type: "km_mainpage" }) {
        id
        handle
        updatedAt
        fields {
          key
          value
          reference {
            __typename
            ... on MediaImage { image { url } }
            ... on GenericFile { url }
          }
        }
      }
      fallback: metaobjects(first: 1, type: "km_mainpage") {
        edges {
          node {
            id
            handle
            updatedAt
            fields {
              key
              value
              reference {
                __typename
                ... on MediaImage { image { url } }
                ... on GenericFile { url }
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyFetch(QUERY, {}, { attempts: 4, timeoutMs: 8000 });
  const main = data?.main || data?.fallback?.edges?.[0]?.node || null;

  return {
    greeting: extractText(main, 'greeting'),
    about: extractText(main, 'about'),
    legalMessage: extractText(main, 'legal_message'),
    legalFulltext: extractText(main, 'legal_fulltext'),
    horseClickMessage: extractText(main, 'horse_click_message'),
    backgroundUrl: extractBackground(main),
    updatedAt: main?.updatedAt || null,
  };
}
