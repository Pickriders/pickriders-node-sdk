/**
 * In the browser: show a customer their delivery live, from the tracking link your server got
 * on the order. No API key involved.
 */
import { trackDelivery } from 'pickriders/client';

const LABELS = {
  scheduled: 'Scheduled',
  awaiting_dispatch: 'Getting ready',
  searching: 'Finding a rider',
  rider_assigned: 'Rider on the way to pick up',
  picking_up: 'Rider at pickup',
  in_transit: 'On the way to you',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Couldn’t be delivered',
} as const;

export function showDelivery(trackingUrl: string, element: HTMLElement) {
  const delivery = trackDelivery(trackingUrl);

  const unsubscribe = delivery.subscribe(({ data, error }) => {
    if (!data) return;
    const eta = data.eta_s ? ` · about ${Math.ceil(data.eta_s / 60)} min` : '';
    element.textContent = `${LABELS[data.status]}${data.rider ? ` · ${data.rider.name}` : ''}${eta}`;
    element.dataset.stale = String(Boolean(error));
  });

  // Call this when the view goes away.
  return () => {
    unsubscribe();
    delivery.stop();
  };
}
