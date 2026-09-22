// 쿠팡·네이버 API의 주소와 경로를 한곳에 모아둔다.
//
// 실제 규격이 바뀌거나 우리가 잘못 적었을 때 여기만 고치면 되도록 분리했다.
// 각 경로 옆에 공식 문서에서 확인해야 할 이름을 적어둔다.
//
// BASE는 환경변수로 바꿀 수 있다. 자격증명 없이 동작을 시험할 때 모의
// 서버를 가리키게 하려는 것이며, 설정하지 않으면 실제 주소를 쓴다.

export const COUPANG_BASE =
  process.env.COUPANG_API_BASE ?? "https://api-gateway.coupang.com";

export const NAVER_BASE =
  process.env.NAVER_API_BASE ?? "https://api.commerce.naver.com/external";

/** 쿠팡 Open API 경로. {vendorId}는 호출할 때 채운다. */
export const COUPANG_PATHS = {
  // 상품 목록 (기존 coupang.ts가 쓰던 경로)
  sellerProducts: "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products",
  // 주문서 목록 조회
  ordersheets: (vendorId: string) =>
    `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets`,
  // 발주 확인 (= 상품준비중 처리)
  acknowledgement: (vendorId: string) =>
    `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets/acknowledgement`,
  // 판매가 변경
  price: (sellerProductItemId: string, price: number) =>
    `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${sellerProductItemId}/prices/${price}`,
};

/** 네이버 커머스 API 경로. */
export const NAVER_PATHS = {
  token: "/v1/oauth2/token",
  productSearch: "/v1/products/search",
  // 기간으로 주문(상품주문) 조회
  productOrders: "/v1/pay-order/seller/product-orders",
  // 발주 확인
  confirmOrders: "/v1/pay-order/seller/product-orders/confirm",
  // 원상품 수정 (가격·재고)
  originProduct: (originProductNo: string | number) =>
    `/v1/products/origin-products/${originProductNo}`,
};

/** 쿠팡 주문 상태값. 조회할 때 status로 넘긴다. */
export const COUPANG_ORDER_STATUS = {
  결제완료: "ACCEPT",
  상품준비중: "INSTRUCT",
  배송지시: "DEPARTURE",
  배송중: "DELIVERING",
  배송완료: "FINAL_DELIVERY",
} as const;
