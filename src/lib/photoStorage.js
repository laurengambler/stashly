// lib/photoStorage.js
// IndexedDB-backed store for gift card photo blobs.
//
// Card metadata (merchant, number, PIN, etc.) continues to live in
// localStorage via storage.js. This module exists as a *sibling* store
// because image blobs are too large for localStorage's ~5MB per-origin
// quota. Each card references its photos by ID (frontPhotoId /
// backPhotoId); the actual Blob is kept here.

const DB_NAME = 'stashly_photos'
const DB_VERSION = 1
const STORE = 'photos'

let _dbPromise = null

const openDb = () => {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      _dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => {
      _dbPromise = null
      reject(new Error('IndexedDB blocked'))
    }
  })
  return _dbPromise
}

// Stable ID for a newly-stored photo. Prefix keeps it easy to grep
// in stored card data.
export const newPhotoId = () =>
  'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

export const savePhoto = async (id, blob) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite')
    t.objectStore(STORE).put(blob, id)
    t.oncomplete = () => resolve(id)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export const getPhoto = async (id) => {
  if (!id) return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export const deletePhoto = async (id) => {
  if (!id) return
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite')
    t.objectStore(STORE).delete(id)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

// Downscale + re-encode to JPEG before storing. A raw phone photo can
// be 5–10MB; compressed we target ~150–400KB per photo, which keeps
// the IndexedDB footprint reasonable and makes loads snappy. If the
// source can't be decoded (e.g. an unfamiliar codec), fall back to
// storing the original file so we never silently drop the user's
// upload.
export const compressImage = (file, maxDim = 1600, quality = 0.85) =>
  new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      resolve(file)
      return
    }
    const objUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onerror = () => {
      URL.revokeObjectURL(objUrl)
      resolve(file)
    }
    img.onload = () => {
      URL.revokeObjectURL(objUrl)
      let { width, height } = img
      const largest = Math.max(width, height)
      if (largest > maxDim) {
        const scale = maxDim / largest
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => resolve(blob || file),
        'image/jpeg',
        quality
      )
    }
    img.src = objUrl
  })
