/**
 * A FIFO (First In, First Out) Set implementation with a maximum capacity.
 * When the capacity is exceeded, the oldest items are removed to make room for new ones.
 */
export class FifoSet<T> {
  private items: Set<T> = new Set();
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = 100) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Creates a new FifoSet from an array of items
   * @param items Array of items to populate the set with (in FIFO order)
   * @param maxCapacity Maximum capacity for the new set (defaults to 100)
   * @returns A new FifoSet instance populated with the given items
   */
  static deserialize<T>(items: T[], maxCapacity: number = 100): FifoSet<T> {
    const fifoSet = new FifoSet<T>(maxCapacity);

    // Add items in order, respecting capacity limits
    for (const item of items) {
      fifoSet.add(item);
    }

    return fifoSet;
  }

  /**
   * Adds an item to the set. If the item already exists, it won't be added again.
   * If the set is at capacity, the oldest item will be removed.
   * @param item The item to add
   * @returns true if the item was added, false if it already existed
   */
  add(item: T): boolean {
    // If item already exists, don't add it again
    if (this.items.has(item)) {
      return false;
    }

    // If at capacity, remove the oldest item (first in the set)
    if (this.items.size >= this.maxCapacity) {
      const oldestItem = this.items.values().next().value;
      if (oldestItem !== undefined) {
        this.items.delete(oldestItem);
      }
    }

    // Add the new item to the end (most recent)
    this.items.add(item);
    return true;
  }

  /**
   * Checks if an item exists in the set
   * @param item The item to check for
   * @returns true if the item exists, false otherwise
   */
  has(item: T): boolean {
    return this.items.has(item);
  }

  /**
   * Removes an item from the set
   * @param item The item to remove
   * @returns true if the item was removed, false if it didn't exist
   */
  delete(item: T): boolean {
    return this.items.delete(item);
  }

  /**
   * Clears all items from the set
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * Gets the current size of the set
   * @returns The number of items in the set
   */
  get size(): number {
    return this.items.size;
  }

  /**
   * Gets the maximum capacity of the set
   * @returns The maximum number of items the set can hold
   */
  get capacity(): number {
    return this.maxCapacity;
  }

  /**
   * Serializes the set to an array in FIFO order (oldest first)
   * @returns An array containing all items in the set, ordered from oldest to newest
   */
  serialize(): T[] {
    return Array.from(this.items);
  }

  /**
   * Creates an iterator for the set items in FIFO order
   */
  *[Symbol.iterator](): Iterator<T> {
    yield* this.items;
  }
}