import { randomUUID } from "node:crypto";

/**
 * Short, BullMQ-safe job id (8 hex chars). BullMQ rejects jobIds that parse as
 * integers ("Custom Id cannot be integers"), and `randomUUID().slice(0, 8)`
 * is all-hex with a ~0.4% chance of producing an all-digit string. Re-roll
 * until at least one non-digit appears; fall back to a literal "j" prefix in
 * the astronomically unlikely event that five rolls all come up digits.
 */
export function shortJobId(): string {
  for (let i = 0; i < 5; i++) {
    const id = randomUUID().slice(0, 8);
    if (!/^\d+$/.test(id)) return id;
  }
  return "j" + randomUUID().slice(0, 7);
}
