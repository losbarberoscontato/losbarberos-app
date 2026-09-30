-- Publish the MusicPro neon-blue identity and keep the editable draft in sync.
with neon_config as (
  select jsonb_build_object(
    'primary', '#06233b',
    'secondary', '#075a96',
    'accent', '#00a6ff',
    'background', '#f1f8fd',
    'surface', '#ffffff',
    'text', '#0b1f33',
    'muted', '#536b80',
    'border', '#d3e3ef',
    'success', '#277b5a',
    'danger', '#b43b45',
    'primarySoft', '#dceeff',
    'accentSoft', '#d9f2ff',
    'accentDeep', '#075a96',
    'accentHover', '#008bd5',
    'accentTint', '#e9f7ff',
    'focusRing', '#35bdfc'
  ) as colors
)
update public.platform_product_identities as identity
set config = jsonb_set(
  jsonb_set(identity.config, '{brand,logoUrl}', to_jsonb('/music-pro/logo-neon.png'::text), true),
  '{colors}', neon_config.colors, true
),
revision = identity.revision + 1,
published_at = now()
from neon_config
where identity.product_key = 'music-pro';

with neon_config as (
  select jsonb_build_object(
    'primary', '#06233b',
    'secondary', '#075a96',
    'accent', '#00a6ff',
    'background', '#f1f8fd',
    'surface', '#ffffff',
    'text', '#0b1f33',
    'muted', '#536b80',
    'border', '#d3e3ef',
    'success', '#277b5a',
    'danger', '#b43b45',
    'primarySoft', '#dceeff',
    'accentSoft', '#d9f2ff',
    'accentDeep', '#075a96',
    'accentHover', '#008bd5',
    'accentTint', '#e9f7ff',
    'focusRing', '#35bdfc'
  ) as colors
)
update public.platform_product_identity_drafts as draft
set config = jsonb_set(
  jsonb_set(draft.config, '{brand,logoUrl}', to_jsonb('/music-pro/logo-neon.png'::text), true),
  '{colors}', neon_config.colors, true
),
updated_at = now()
from neon_config
where draft.product_key = 'music-pro';
