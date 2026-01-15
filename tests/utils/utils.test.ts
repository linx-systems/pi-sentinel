import {describe, expect, it} from 'vitest';
import {formatNumber, isQueryBlocked, isSameSite} from '~/utils/utils';

describe('utils', () => {
    describe('formatNumber', () => {
        it('should format numbers less than 1000 without suffix', () => {
            expect(formatNumber(0)).toBe('0');
            expect(formatNumber(1)).toBe('1');
            expect(formatNumber(42)).toBe('42');
            expect(formatNumber(999)).toBe('999');
        });

        it('should format thousands with K suffix', () => {
            expect(formatNumber(1000)).toBe('1.0K');
            expect(formatNumber(1500)).toBe('1.5K');
            expect(formatNumber(10000)).toBe('10.0K');
            expect(formatNumber(999999)).toBe('1000.0K');
        });

        it('should format millions with M suffix', () => {
            expect(formatNumber(1000000)).toBe('1.0M');
            expect(formatNumber(1500000)).toBe('1.5M');
            expect(formatNumber(2340000)).toBe('2.3M');
            expect(formatNumber(10000000)).toBe('10.0M');
        });

        it('should round to 1 decimal place', () => {
            expect(formatNumber(1234)).toBe('1.2K');
            expect(formatNumber(1267)).toBe('1.3K');
            expect(formatNumber(1234567)).toBe('1.2M');
        });
    });

    describe('isSameSite', () => {
        it('should return true for same exact domains', () => {
            expect(isSameSite('example.com', 'example.com')).toBe(true);
            expect(isSameSite('api.example.com', 'api.example.com')).toBe(true);
        });

        it('should return true for same eTLD+1', () => {
            expect(isSameSite('api.example.com', 'www.example.com')).toBe(true);
            expect(isSameSite('cdn.example.com', 'example.com')).toBe(true);
            expect(isSameSite('deep.nested.example.com', 'example.com')).toBe(true);
        });

        it('should return false for different eTLD+1', () => {
            expect(isSameSite('example.com', 'other.com')).toBe(false);
            expect(isSameSite('api.example.com', 'api.other.com')).toBe(false);
            expect(isSameSite('google.com', 'facebook.com')).toBe(false);
        });

        it('should handle domains without subdomains', () => {
            expect(isSameSite('com', 'com')).toBe(true);
            expect(isSameSite('localhost', 'localhost')).toBe(true);
        });
    });

    describe('isQueryBlocked', () => {
        describe('string statuses', () => {
            it('should return true for blocked statuses', () => {
                expect(isQueryBlocked('GRAVITY')).toBe(true);
                expect(isQueryBlocked('BLACKLIST')).toBe(true);
                expect(isQueryBlocked('DENYLIST')).toBe(true);
                expect(isQueryBlocked('REGEX')).toBe(true);
                expect(isQueryBlocked('EXTERNAL_BLOCKED_IP')).toBe(true);
                expect(isQueryBlocked('EXTERNAL_BLOCKED_NULL')).toBe(true);
                expect(isQueryBlocked('EXTERNAL_BLOCKED_NXRA')).toBe(true);
                expect(isQueryBlocked('BLOCKED')).toBe(true);
                expect(isQueryBlocked('SPECIAL_DOMAIN')).toBe(true);
                expect(isQueryBlocked('DATABASE_BUSY')).toBe(true);
            });

            it('should be case-insensitive for blocked statuses', () => {
                expect(isQueryBlocked('gravity')).toBe(true);
                expect(isQueryBlocked('Gravity')).toBe(true);
                expect(isQueryBlocked('GRAVITY')).toBe(true);
                expect(isQueryBlocked('denylist')).toBe(true);
            });

            it('should return false for allowed statuses', () => {
                expect(isQueryBlocked('FORWARDED')).toBe(false);
                expect(isQueryBlocked('CACHE')).toBe(false);
                expect(isQueryBlocked('UPSTREAM_ANSWERED')).toBe(false);
                expect(isQueryBlocked('RETRIED')).toBe(false);
                expect(isQueryBlocked('ALLOWED')).toBe(false);
            });
        });

        describe('numeric statuses', () => {
            it('should return true for blocked numeric statuses (2-11)', () => {
                expect(isQueryBlocked(2)).toBe(true);
                expect(isQueryBlocked(3)).toBe(true);
                expect(isQueryBlocked(5)).toBe(true);
                expect(isQueryBlocked(11)).toBe(true);
            });

            it('should return false for allowed numeric statuses', () => {
                expect(isQueryBlocked(0)).toBe(false);
                expect(isQueryBlocked(1)).toBe(false);
                expect(isQueryBlocked(12)).toBe(false);
                expect(isQueryBlocked(15)).toBe(false);
                expect(isQueryBlocked(-1)).toBe(false);
            });
        });

        describe('edge cases', () => {
            it('should return false for null/undefined', () => {
                expect(isQueryBlocked(null)).toBe(false);
                expect(isQueryBlocked(undefined)).toBe(false);
            });
        });
    });
});
