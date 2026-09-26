function monthlyPaymentEqualPrincipal(principal, annualRate, years) {
  const r = annualRate / 12 / 100
  const n = years * 12
  if (r === 0) {
    return principal / n
  }
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function firstPaymentEqualInstallment(principal, annualRate, years) {
  const r = annualRate / 12 / 100
  const n = years * 12
  return principal / n + principal * r
}

function totalInterestEqualPrincipal(principal, annualRate, years) {
  const monthly = monthlyPaymentEqualPrincipal(principal, annualRate, years)
  return monthly * years * 12 - principal
}

function totalInterestEqualInstallment(principal, annualRate, years) {
  const r = annualRate / 12 / 100
  const n = years * 12
  return principal * r * (n + 1) / 2
}

function lastPaymentEqualInstallment(principal, annualRate, years) {
  const r = annualRate / 12 / 100
  const n = years * 12
  const monthlyPrincipal = principal / n
  const lastInterest = monthlyPrincipal * r
  return monthlyPrincipal + lastInterest
}

function rentRatio(monthlyRentPerSqm, pricePerSqm) {
  if (!pricePerSqm || pricePerSqm <= 0) {
    return null
  }
  return monthlyRentPerSqm / pricePerSqm
}

function annualReturn(rentRatioValue) {
  if (rentRatioValue === null || rentRatioValue === undefined) {
    return null
  }
  return rentRatioValue * 12
}

function bestValueGap(salePrice, evalPrice, area) {
  return (salePrice - evalPrice) * area * 0.85
}

function valueGrade(gap) {
  if (gap >= 500000) {
    return { grade: '高', desc: '50万以上' }
  }
  if (gap >= 200000) {
    return { grade: '中', desc: '20万-50万' }
  }
  return { grade: '低', desc: '0-20万' }
}

function suggestDealPrice(recentDealPrice, discountRate) {
  return recentDealPrice * (1 - discountRate / 100)
}

module.exports = {
  monthlyPaymentEqualPrincipal,
  firstPaymentEqualInstallment,
  lastPaymentEqualInstallment,
  totalInterestEqualPrincipal,
  totalInterestEqualInstallment,
  rentRatio,
  annualReturn,
  bestValueGap,
  valueGrade,
  suggestDealPrice
}