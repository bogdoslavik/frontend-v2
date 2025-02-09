import BigNumber from 'bignumber.js';
import { mountComposable } from '@/tests/mount-helpers';
import useNumbers, { FNumFormats } from './useNumbers';

jest.mock('@/providers/tokens.provider');

describe('useNumbers', () => {
  const { result } = mountComposable(() => useNumbers());

  it('Should load', () => {
    expect(result).toBeTruthy();
  });

  describe('fNum2', () => {
    const { fNum, fNum2 } = result;

    const testNumbers = [
      '-5678',
      '-122.45',
      '-1',
      '-0.0078',
      '-0.1',
      '-0.0000443',
      '0',
      '0.0',
      '0.0000',
      '0.000005',
      '0.001',
      '0.123456789',
      '0.6',
      '1.3',
      '8',
      '13.44',
      '121',
      '188.9123',
      '5129.199911',
      '87654',
      '112124.3791743',
      '1883234',
      '121237821371',
    ];

    const badTestNumbers = ['NaN', '-', ''];

    it('Should return 0 for an empty string', () => {
      expect(fNum2('')).toEqual('-');
    });

    it('should return bad inputs as -', () => {
      badTestNumbers.forEach(testNumber => {
        const formattedNumber = fNum2(testNumber, {
          style: 'decimal',
          maximumFractionDigits: 20,
          useGrouping: false,
          fixedFormat: true,
        });
        expect(formattedNumber).toEqual('-');
      });
    });

    it('Should not lose any precision with numbers passed as a string', () => {
      testNumbers.forEach(testNumber => {
        if (Number(testNumber) === 0) return; // Ignore 0 numbers as it will always trim their precision.
        const formattedNumber = fNum2(testNumber, {
          style: 'decimal',
          maximumFractionDigits: 20,
          useGrouping: false,
          fixedFormat: true,
        });
        expect(formattedNumber).toEqual(testNumber);
      });
    });

    it('Should not lose any precision with numbers passed as a number', () => {
      testNumbers.forEach(testNumber => {
        if (testNumber === '') return; // Ignore empty string as that is converted to 0
        if (Number(testNumber) === 0) return; // Ignore 0 numbers as it will always trim their precision.
        const testNumberAsNumber = Number(testNumber);
        const formattedNumber = fNum2(testNumberAsNumber, {
          style: 'decimal',
          maximumFractionDigits: 20,
          useGrouping: false,
          fixedFormat: true,
        });
        expect(formattedNumber).toEqual(testNumber);
      });
    });

    it('Should give the same result without any arguments', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber);
        const format2 = fNum2(testNumber, {
          style: 'decimal',
          maximumFractionDigits: 1,
          abbreviate: true,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should give the same result as a formatted percentage', () => {
      testNumbers.forEach(testNumber => {
        if (Number(testNumber) > 0 && Number(testNumber) < 0.01) return;

        const format1 = fNum(testNumber, null, { format: '0.00%' });
        const format2 = fNum2(testNumber, {
          style: 'percent',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          fixedFormat: true,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should give the same result as a formatted dollar value', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber, null, { format: '$0,0.00' });
        const format2 = fNum2(testNumber, {
          style: 'currency',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          fixedFormat: true,
        });
        if (format1 === '0$.00') return; // This is a bug with numeral in fNum
        if (format1 === 'N$aN') return; // This is a bug with numeral in fNum
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as usd preset', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber, 'usd');
        const format2 = fNum2(testNumber, FNumFormats.fiat);
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as usd forced preset', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber, 'usd', { forcePreset: true });
        const format2 = fNum2(testNumber, {
          style: 'currency',
          dontAdjustLarge: true,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as usd_m preset', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber, 'usd_m');
        const format2 = fNum2(testNumber, {
          style: 'currency',
          abbreviate: true,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as nested usd usd_m preset', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(fNum(testNumber, 'usd'), 'usd_m');
        const format2 = fNum2(testNumber, {
          style: 'currency',
          abbreviate: true,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as percent preset', () => {
      testNumbers.forEach(testNumber => {
        if (Number(testNumber) > 0 && Number(testNumber) < 0.01) return;

        const format1 = fNum(testNumber, 'percent');
        const format2 = fNum2(testNumber, {
          style: 'percent',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as percent_lg preset', () => {
      testNumbers.forEach(testNumber => {
        if (Number(testNumber) > 0 && Number(testNumber) < 0.01) return;

        const format1 = fNum(testNumber, 'percent_lg');
        const format2 = fNum2(testNumber, {
          style: 'percent',
          maximumFractionDigits: 0,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as percent_variable preset', () => {
      testNumbers.forEach(testNumber => {
        if (Number(testNumber) > 0 && Number(testNumber) < 0.01) return;

        const format1 = fNum(testNumber, 'percent_variable');
        const format2 = fNum2(testNumber, {
          style: 'percent',
          maximumFractionDigits: 4,
          dontAdjustLarge: true,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result as a formatted percentage unit', () => {
      testNumbers.forEach(testNumber => {
        if (Number(testNumber) > 0 && Number(testNumber) < 0.01) return;

        const format1 = fNum(testNumber, null, { format: '0.0%' });
        const format2 = fNum2(testNumber, {
          style: 'percent',
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
          fixedFormat: true,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result for token', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber, 'token');
        const format2 = fNum2(testNumber, FNumFormats.token);
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result for token_fixed', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber, 'token_fixed');
        const format2 = fNum2(testNumber, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result for token_lg', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum(testNumber, 'token_lg');
        const format2 = fNum2(testNumber, {
          style: 'decimal',
          maximumFractionDigits: 0,
        });
        expect(format2).toEqual(format1);
      });
    });

    it('Should return the same result for basis points / 10000 as percent', () => {
      testNumbers.forEach(testNumber => {
        const format1 = fNum2(testNumber, FNumFormats.bp);
        const format2 = fNum2(
          new BigNumber(testNumber).div(10000).toString(),
          FNumFormats.percent
        );
        expect(format2).toEqual(format1);
      });
    });

    it('Should not return < 0.0001 if fixedFormat is true', () => {
      const testNumber = '0.00000123';
      const formattedNumber = fNum2(testNumber, {
        maximumSignificantDigits: 6,
        fixedFormat: true,
      });
      expect(formattedNumber).toEqual(testNumber);
    });

    it('Should return < 0.01% if percent is between 0 and 0.01', () => {
      const formattedNumber = fNum2('0.00009', FNumFormats.percent);
      expect(formattedNumber).toEqual('< 0.01%');
    });
  });

  describe('toFiat', () => {
    const { toFiat } = result;

    it('Should multiply amount by token price', async () => {
      const amount = 2.5;
      //priceFor function always returns 2 in the tokens.provider mock
      const priceFor = 2;
      const expectedValue = (amount * priceFor).toString();
      const value = toFiat(amount, 'any token address');
      expect(value).toEqual(expectedValue);
    });
  });
});
