import { OPEN_ORDER_REFETCH_MS, queryKeys, useApi, useQuery } from '@oregano/app-core';
import type { AdminOrderRow } from '@oregano/contracts';
import { type OrderStatus, poisha } from '@oregano/domain';
import { formatMoney, type MessageKey, t } from '@oregano/i18n';

const LABELS: Record<OrderStatus, MessageKey> = {
  placed: 'order.placed',
  preparing: 'order.preparing',
  ready: 'order.ready',
  on_the_way: 'order.onTheWay',
  delivered: 'order.delivered',
  rejected: 'order.rejected',
  cancelled: 'order.cancelled',
  // Plan 02 never produces these two; they read as the nearest outcome, as in the apps.
  expired: 'order.rejected',
  undeliverable: 'order.cancelled',
};

const COLUMNS = ['Order', 'Status', 'Restaurant', 'Customer', 'Rider', 'Total', 'Placed'] as const;

function placedAt(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Row(props: { order: AdminOrderRow }) {
  const { order } = props;
  const label = t('en', 'order.number', { number: order.number });
  return (
    <tr aria-label={label}>
      <td>{label}</td>
      <td>{t('en', LABELS[order.status])}</td>
      <td>{order.restaurantNameEn}</td>
      <td>{order.customerPhone}</td>
      <td>{order.riderName ? `${order.riderName} ${order.riderPhone ?? ''}`.trim() : '—'}</td>
      <td>{formatMoney(poisha(order.total))}</td>
      <td>{placedAt(order.createdAt)}</td>
    </tr>
  );
}

/** Every order from the last 24 hours, refreshed by realtime hints and a 15 second poll. */
export function Orders() {
  const api = useApi();
  const query = useQuery({
    queryKey: queryKeys.adminOrders,
    queryFn: () => api.adminOrders(),
    refetchInterval: OPEN_ORDER_REFETCH_MS,
  });

  if (query.isError) return <p role="alert">{t('en', 'error.generic')}</p>;
  if (!query.data) return <p>Loading…</p>;

  return (
    <>
      <h1>Orders, last 24 hours</h1>
      {query.data.length === 0 ? <p className="muted">No orders yet.</p> : null}
      <table>
        <thead>
          <tr>
            {COLUMNS.map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {query.data.map((order) => (
            <Row key={order.id} order={order} />
          ))}
        </tbody>
      </table>
    </>
  );
}
