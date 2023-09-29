# How Did Angular parse selector from Directive and Component ?

Angular only allows directives to apply on CSS selectors that do not cross element boundarie,
meaning all CSS combinators  ( > ~ + and "space" ) are forbidden.

So, how did angular deal with them when transforming CSS selector of Directive | Component ? 

You can try it yourself online to debug some issues or improve your knowledge of this specific parsing
