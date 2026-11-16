/** The master list of message keys. Bangla must define every key here. */
export const en = {
  'brand.promise': "Your town's food, in one place.",
  'action.placeOrder': 'Place order',
  'action.tryAgain': 'Try again',
  'action.continueAsGuest': 'Continue as guest',
  'status.offline': "You're offline. Try again.",
  'zone.outside': "We don't deliver here yet",
  'item.soldOut': 'Sold out today',
  'restaurant.opensAt': 'Opens at {time}',
  'restaurant.samePrice': 'Same price as in store',
  'language.switchTo': 'বাংলা',
} as const;

export type MessageKey = keyof typeof en;
