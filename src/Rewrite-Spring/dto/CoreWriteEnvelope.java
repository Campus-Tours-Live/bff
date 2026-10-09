package com.campustourslive.bff.dto;

import java.util.List;
public record CoreWriteEnvelope<T, A>(T data, List<A> affectedBookings) {}
