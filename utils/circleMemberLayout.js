const MEMBER_SLOTS = 6;
const CIRCLE_R = 280;
const AVATAR_SIZE = 80;
const CENTER_XY = 300;
const START_ANGLE = -Math.PI / 2;

const { assignAvatarImages } = require('./avatars');

function expandMembersToSlots(members) {
  const arr = [...(members || [])];
  while (arr.length < MEMBER_SLOTS) arr.push(null);
  return arr.slice(0, MEMBER_SLOTS);
}

function dedupeMembersById(members) {
  const seen = new Set();
  return (members || []).filter((m) => {
    if (!m) return true;
    const id = m.userId || m.openid || (m.playerIndex != null ? `p${m.playerIndex}` : null);
    const key = id != null ? id : `i${seen.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMemberSlots(members) {
  const n = MEMBER_SLOTS;
  const slots = [];
  const half = AVATAR_SIZE / 2;
  const centerX = CENTER_XY;
  const centerY = CENTER_XY;

  for (let i = 0; i < n; i++) {
    const angle = START_ANGLE + (i * 2 * Math.PI) / n;
    const member = members[i] || null;
    const left = Math.round(centerX + CIRCLE_R * Math.cos(angle) - half);
    const top = Math.round(centerY + CIRCLE_R * Math.sin(angle) - half);
    const slotCenterX = left + half;
    const slotCenterY = top + half;
    const dx = slotCenterX - centerX;
    const dy = slotCenterY - centerY;
    const lineLength = Math.round(Math.sqrt(dx * dx + dy * dy));
    const lineAngleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);

    slots.push({
      index: i,
      left,
      top,
      member,
      lineLength: member ? lineLength : 0,
      lineAngleDeg: member ? lineAngleDeg : 0
    });
  }
  return slots;
}

module.exports = {
  MEMBER_SLOTS,
  CIRCLE_R,
  AVATAR_SIZE,
  CENTER_XY,
  assignAvatarImages,
  expandMembersToSlots,
  dedupeMembersById,
  buildMemberSlots
};
