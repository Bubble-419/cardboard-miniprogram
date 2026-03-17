/** 头像图片列表，按 avatarIndex 分配给成员，与 addPlayer 一致 */
const AVATAR_IMAGES = [
  '/assets/avatar/Frame 2085662241.png',
  '/assets/avatar/Frame 2085662242.png',
  '/assets/avatar/Frame 2085662243.png',
  '/assets/avatar/Frame 2085662244.png',
  '/assets/avatar/Frame 2085662245.png',
  '/assets/avatar/Frame 2085662246.png',
  '/assets/avatar/Frame 2085662247.png',
  '/assets/avatar/Frame 2085662248.png',
  '/assets/avatar/Frame 2085662249.png'
];

/** 为成员列表补充 avatarImage（按 avatarIndex 映射，无则按顺序分配） */
function assignAvatarImages(members) {
  return (members || []).map((m, i) => {
    if (!m) return m;
    const idx = m.avatarIndex != null ? m.avatarIndex : i % AVATAR_IMAGES.length;
    const avatarImage = AVATAR_IMAGES[idx % AVATAR_IMAGES.length] || AVATAR_IMAGES[0];
    return { ...m, avatarImage };
  });
}

module.exports = {
  AVATAR_IMAGES,
  assignAvatarImages
};
