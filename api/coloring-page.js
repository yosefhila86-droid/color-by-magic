const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = 4 * 1024 * 1024;
const OPENAI_URL = 'https://api.openai.com/v1/images/edits';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to create a coloring page.' });
  }

  try {
    if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) {
      return res.status(403).json({ error: 'Requests must come from this app.' });
    }
  } catch (error) {
    return res.status(403).json({ error: 'Requests must come from this app.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI conversion is not configured on this deployment.' });
  }

  const image = req.body && req.body.image;
  if (typeof image !== 'string' || image.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return res.status(400).json({ error: 'The image is missing or too large.' });
  }

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) {
    return res.status(400).json({ error: 'Send a JPEG, PNG, or WebP image.' });
  }

  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
    return res.status(400).json({ error: 'The image is invalid or too large.' });
  }

  const contentType = `image/${match[1]}`;
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', new Blob([bytes], { type: contentType }), `source.${extension}`);
  form.append('prompt', [
    'Transform the supplied photo into a polished, child-friendly black-and-white coloring-book page.',
    'Preserve the main subject and recognizable pose, but simplify it into clean, confident, smooth black outlines on a pure white background.',
    'Create separate, fully enclosed colorable regions for facial features, hair, clothing, limbs, and important shapes; keep boundaries between adjacent body parts clear.',
    'When the subject has waves, curls, folds, or other internal contours, draw their boundaries clearly so those shapes can be colored separately instead of merging into one large area.',
    'Use enough internal contour lines to separate distinct shapes and patterns, while omitting photographic texture, shading, gradients, gray fills, and color.',
    'Keep outlines crisp and moderately bold, avoid large solid-black areas, and simplify background clutter.',
    'Return only a square page of printable line art with no text, labels, frame, or watermark.'
  ].join(' '));
  form.append('size', '1024x1024');
  form.append('quality', 'medium');
  form.append('output_format', 'png');

  let upstream;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
  } catch (error) {
    console.error('OpenAI image edit request failed:', error);
    return res.status(502).json({ error: 'The AI image service could not be reached. Please try again.' });
  }

  if (!upstream.ok) {
    console.error('OpenAI image edit returned status:', upstream.status);
    return res.status(502).json({ error: 'The AI image service could not process this photo. Please try again.' });
  }

  let result;
  try {
    result = await upstream.json();
  } catch (error) {
    console.error('OpenAI image edit returned invalid JSON:', error);
    return res.status(502).json({ error: 'The AI image service returned an invalid response.' });
  }

  const imageData = result && result.data && result.data[0] && result.data[0].b64_json;
  if (typeof imageData !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
    console.error('OpenAI image edit response contained no PNG data.');
    return res.status(502).json({ error: 'The AI image service did not return a usable image.' });
  }

  return res.status(200).json({ image: `data:image/png;base64,${imageData}` });
};

module.exports.config = { maxDuration: 60 };
