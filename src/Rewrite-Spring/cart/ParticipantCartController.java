package com.campustourslive.bff.cart;

import com.campustourslive.bff.web.AuthenticatedHandlers;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Java equivalent of cart routes.ts; CSRF protection is configured separately. */
@RestController
@RequestMapping("/v1/cart")
public class ParticipantCartController {
    private final AuthenticatedHandlers authenticated;
    private final ParticipantCartService cart;

    public ParticipantCartController(AuthenticatedHandlers authenticated, ParticipantCartService cart) {
        this.authenticated = authenticated;
        this.cart = cart;
    }

    @GetMapping
    public ResponseEntity<?> getCart(HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withSession(request, response, core -> cart.getCart(core, response));
    }

    @PostMapping("/items")
    public ResponseEntity<?> addCartItem(@RequestBody(required = false) Object body,
                                         HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withMutation(request, response,
                core -> cart.addCartItem(core, body, request, response));
    }

    @DeleteMapping("/items/{id}")
    public ResponseEntity<?> removeCartItem(@PathVariable String id,
                                            HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withMutation(request, response,
                core -> cart.removeCartItem(core, id, request, response));
    }

    @PostMapping("/checkout")
    public ResponseEntity<?> checkout(HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withMutation(request, response,
                core -> cart.checkout(core, request, response));
    }
}
